/**
 * The snapshot client (feature-snapshot-protocol.yaml client): fetches the features your own server
 * re-serves from FeatureHub (a snapshot server, such as the Node SDK's FeatureSnapshotStore behind an HTTP
 * handler) and loads them into the repository. It does not talk to FeatureHub Edge, and computes no SHA: it
 * uses the server's ETag (or the snapshot's sha) as it is.
 */
import { type ContextRecord, contextValueToString } from "../client_context";
import { EdgeFeatureHubConfig } from "../edge_featurehub_config";
import type { EdgeService } from "../edge_service";
import {
  type ExtraHeaders,
  type FeatureHubConfig,
  fhLog,
  validatePollInterval,
} from "../feature_hub_config";
import { decodeFeatureSnapshot } from "../feature_snapshot";
import type { InternalFeatureRepository } from "../internal_feature_repository";
import { SSEResultState } from "../models";

export interface FeatureSnapshotClientOptions {
  /** the full URL of the snapshot server's features endpoint; it may already have query parameters */
  url: string;
  /**
   * Send the context as query parameters, so the server evaluates the features for it (the default). When
   * false no context is sent: the server must serve the rollout strategies, and the features are evaluated
   * locally for each context.
   */
  sendContext?: boolean;
  /** how often to poll, and how long a response stays fresh; 0 fetches once. Default 30 seconds */
  intervalMs?: number;
  /** fetch only when a feature is evaluated and the last response is older than the interval */
  passive?: boolean;
  /** headers sent with every request (an API gateway's, say) */
  headers?: ExtraHeaders;
  /** abandon a request that takes longer than this (it is retried later) */
  requestTimeoutMs?: number;
  /** the fetch to make requests with (one configured with a proxy, say); the global fetch by default */
  fetch?: typeof fetch;
}

const SOURCE = "snapshot-client";
const DEFAULT_INTERVAL_MS = 30000;

/**
 * The URL for a context (feature-snapshot-protocol.yaml client.request.url_construction): the URL's own
 * query parameters, then each context attribute, a list as a repeated parameter; an attribute replaces a URL
 * parameter of the same name. With no attributes the URL is used as it is. The URL may be relative.
 */
export function snapshotRequestUrl(url: string, attributes: ContextRecord | undefined): string {
  const entries = Object.entries(attributes ?? {})
    // a strategy-only name, never sent (featurehub-protocol.yaml encoding.evaluation_context)
    .filter(([key]) => key.toLowerCase() !== "fhubwhenactive")
    .map(([key, value]) => {
      const values = (Array.isArray(value) ? value : [value])
        .map((v) => contextValueToString(v))
        .filter((v): v is string => v !== undefined);
      return [key, values] as const;
    })
    .filter(([, values]) => values.length > 0);

  if (entries.length === 0) {
    return url;
  }

  const hashAt = url.indexOf("#");
  const withoutHash = hashAt === -1 ? url : url.substring(0, hashAt);
  const queryAt = withoutHash.indexOf("?");
  const base = queryAt === -1 ? withoutHash : withoutHash.substring(0, queryAt);
  const params = new URLSearchParams(queryAt === -1 ? "" : withoutHash.substring(queryAt + 1));

  for (const [key, values] of entries) {
    params.delete(key);
    values.forEach((v) => params.append(key, v));
  }

  return `${base}?${params.toString()}`;
}

function extraHeaders(headers: ExtraHeaders | undefined): Record<string, string> {
  try {
    const supplied = typeof headers === "function" ? headers() : headers;
    if (supplied === null || typeof supplied !== "object") return {};

    return Object.fromEntries(
      Object.entries(supplied).filter(([, value]) => typeof value === "string"),
    );
  } catch (e) {
    fhLog.error("[featurehubsdk] the snapshot client's headers function failed, sending none", e);
    return {};
  }
}

export class FeatureSnapshotEdgeService implements EdgeService {
  private readonly _repository: InternalFeatureRepository;
  private readonly _baseUrl: string;
  private readonly _sendContext: boolean;
  private readonly _intervalMs: number;
  private readonly _passive: boolean;
  private readonly _headers: ExtraHeaders | undefined;
  private readonly _requestTimeoutMs: number | undefined;
  private readonly _fetch: typeof fetch | undefined;

  private _requestUrl: string;
  // an ETag belongs to the exact request URL it was fetched for (and so to its context)
  private _etag: { url: string; etag: string } | undefined;
  private _started = false;
  private _dead = false;
  private _closed = false;
  private _nextAllowed = 0;
  private _timer: ReturnType<typeof setTimeout> | undefined;
  private _inFlight: Promise<void> | undefined;

  constructor(repository: InternalFeatureRepository, options: FeatureSnapshotClientOptions) {
    this._repository = repository;
    this._baseUrl = options.url;
    this._requestUrl = options.url;
    this._sendContext = options.sendContext ?? true;
    this._intervalMs = validatePollInterval(options.intervalMs ?? DEFAULT_INTERVAL_MS);
    this._passive = options.passive ?? false;
    this._headers = options.headers;
    this._requestTimeoutMs = options.requestTimeoutMs;
    this._fetch = options.fetch;
  }

  /** the server rejected the client for good (a 4xx other than 429): it makes no further requests */
  public get dead(): boolean {
    return this._dead;
  }

  clientEvaluated(): boolean {
    return !this._sendContext;
  }

  requiresReplacementOnHeaderChange(): boolean {
    return false;
  }

  async contextChange(_header: string, attributes?: ContextRecord): Promise<void> {
    if (!this._sendContext) {
      return this.poll();
    }

    const url = snapshotRequestUrl(this._baseUrl, attributes);
    if (this._started && url === this._requestUrl) {
      return;
    }

    this._requestUrl = url;
    // a new context is fetched at once
    await this.request(true);
  }

  async poll(fromUsage?: boolean): Promise<void> {
    if (!this._started) {
      await this.request(true);
    } else if (this._passive && fromUsage) {
      await this.request(false);
    }
  }

  close(): void {
    this._closed = true;
    this.cancelTimer();
  }

  private cancelTimer() {
    if (this._timer !== undefined) {
      clearTimeout(this._timer);
      this._timer = undefined;
    }
  }

  // one request at a time: a forced request waits for the one in flight, an unforced one is answered by it.
  // Several forced requests can wait on the same one, so each checks again when it wakes: the first to wake
  // starts the next request, and the others wait for that one in turn
  private async request(forced: boolean): Promise<void> {
    while (this._inFlight) {
      await this._inFlight;
      if (!forced) return;
    }

    if (this._closed || this._dead || (!forced && Date.now() < this._nextAllowed)) {
      return;
    }

    this._started = true;
    this.cancelTimer();
    this._inFlight = this.fetchSnapshot().finally(() => {
      this._inFlight = undefined;
      this.scheduleNext();
    });

    await this._inFlight;
  }

  private scheduleNext() {
    // only ever one timer
    this.cancelTimer();
    // active polling waits the full interval from the end of each request, succeeded or failed
    if (!this._passive && !this._closed && !this._dead && this._intervalMs > 0) {
      this._timer = setTimeout(() => {
        this._timer = undefined;
        void this.request(true);
      }, this._intervalMs);
    }
  }

  private freshUntil(started: number): number {
    // with an interval of 0 we fetch once: a response never goes stale
    return this._intervalMs === 0 ? Number.POSITIVE_INFINITY : started + this._intervalMs;
  }

  private requestHeaders(url: string): Record<string, string> {
    const etag = this._etag?.url === url ? this._etag.etag : undefined;
    // the client's If-None-Match replaces an application's header of the same name, in any case
    const supplied = Object.entries(extraHeaders(this._headers)).filter(
      ([name]) => etag === undefined || name.toLowerCase() !== "if-none-match",
    );

    return {
      ...Object.fromEntries(supplied),
      Accept: "application/json",
      ...(etag === undefined ? {} : { "If-None-Match": etag }),
    };
  }

  private async fetchSnapshot(): Promise<void> {
    const url = this._requestUrl;
    const started = Date.now();
    const controller = new AbortController();
    const timeout = this._requestTimeoutMs
      ? setTimeout(() => controller.abort(), this._requestTimeoutMs)
      : undefined;

    try {
      const doFetch = this._fetch ?? globalThis.fetch;
      const response = await doFetch(url, {
        headers: this.requestHeaders(url),
        signal: controller.signal,
      });

      if (response.status === 304) {
        this._nextAllowed = this.freshUntil(started);
        return;
      }

      if (response.status >= 400 && response.status < 500 && response.status !== 429) {
        // our own server has rejected us for good (unlike FeatureHub, a 429 is retried)
        fhLog.error(
          `[featurehubsdk] the feature snapshot server rejected the request (${response.status})`,
        );
        this._dead = true;
        this._repository.notify(SSEResultState.Failure, null, SOURCE);
        return;
      }

      if (!response.ok) {
        throw new Error(`the feature snapshot server answered ${response.status}`);
      }

      const snapshot = decodeFeatureSnapshot(await response.text());

      if (url !== this._requestUrl) {
        // the context changed while we waited: these are the old context's features
        return;
      }

      // the server's ETag, else the body's sha; with neither there is nothing to validate with
      const etag =
        response.headers.get("etag") ??
        (snapshot.sha === undefined ? undefined : `"${snapshot.sha}"`);
      this._etag = etag === undefined ? undefined : { url, etag };
      this._nextAllowed = this.freshUntil(started);
      this._repository.notify(SSEResultState.Features, snapshot.features, SOURCE);
    } catch (e) {
      // retried by the next poll (or, passively, the next evaluation)
      fhLog.error("[featurehubsdk] failed to fetch the feature snapshot", e);
    } finally {
      clearTimeout(timeout);
    }
  }
}

/**
 * A config whose features come from a snapshot server (your own server re-serving them) rather than
 * FeatureHub Edge. Use it as any other config: `featureSnapshotConfig({ url }).newContext().build()`.
 */
export function featureSnapshotConfig(options: FeatureSnapshotClientOptions): FeatureHubConfig {
  const config = new EdgeFeatureHubConfig();
  const interval = options.intervalMs ?? DEFAULT_INTERVAL_MS;

  config.isClientEvaluated = !(options.sendContext ?? true);
  if (options.passive) {
    // evaluating a feature asks the edge service to poll (it decides whether the response is still fresh)
    config.restPassive(interval);
  } else {
    config.restActive(interval);
  }
  config.edgeServiceProvider((repository) => new FeatureSnapshotEdgeService(repository, options));

  return config;
}

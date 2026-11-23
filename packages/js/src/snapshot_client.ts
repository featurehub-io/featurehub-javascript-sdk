/**
 * The snapshot client (feature-snapshot-protocol.yaml client): fetches the features your own server
 * re-serves from FeatureHub (a snapshot server, such as the Node SDK's featureSnapshotHandler) and loads
 * them into the repository. It does not talk to FeatureHub Edge.
 */
import {
  configExtraHeaders,
  type ContextRecord,
  contextValueToString,
  decodeFeatureSnapshot,
  EdgeFeatureHubConfig,
  type EdgeService,
  type ExtraHeaders,
  type FeatureHubConfig,
  featureSnapshotEtag,
  fhLog,
  type InternalFeatureRepository,
  SSEResultState,
  validatePollInterval,
} from "featurehub-javascript-core-sdk";

export interface FeatureSnapshotClientOptions {
  /** the full URL of the snapshot server's features endpoint; it may already have query parameters */
  url: string;
  /**
   * Send the context as query parameters, so the server evaluates the features for it (the default for a
   * browser client). When false, the server must serve the rollout strategies and the features are
   * evaluated locally for each context.
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
}

const SOURCE = "snapshot-client";

/**
 * The query string for a context (feature-snapshot-protocol.yaml client.request.url_construction): the
 * URL's own parameters, then each context attribute, a list as a repeated parameter; an attribute replaces
 * a URL parameter of the same name. With no attributes the URL is used as it is.
 */
export function snapshotRequestUrl(url: string, attributes: ContextRecord | undefined): string {
  const entries = Object.entries(attributes ?? {})
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

  const request = new URL(url);
  for (const [key, values] of entries) {
    request.searchParams.delete(key);
    values.forEach((v) => request.searchParams.append(key, v));
  }

  return request.toString();
}

export class FeatureSnapshotEdgeService implements EdgeService {
  private readonly _repository: InternalFeatureRepository;
  private readonly _config: FeatureHubConfig;
  private readonly _baseUrl: string;
  private readonly _sendContext: boolean;
  private readonly _intervalMs: number;
  private readonly _passive: boolean;
  private readonly _requestTimeoutMs: number | undefined;

  private _requestUrl: string;
  // an ETag belongs to the exact request URL it was fetched for (and so to its context)
  private _etag: { url: string; etag: string } | undefined;
  private _started = false;
  private _dead = false;
  private _closed = false;
  private _nextAllowed = 0;
  private _timer: ReturnType<typeof setTimeout> | undefined;
  private _inFlight: Promise<void> | undefined;

  constructor(
    repository: InternalFeatureRepository,
    config: FeatureHubConfig,
    options: FeatureSnapshotClientOptions,
  ) {
    this._repository = repository;
    this._config = config;
    this._baseUrl = options.url;
    this._requestUrl = options.url;
    this._sendContext = options.sendContext ?? true;
    this._intervalMs = validatePollInterval(options.intervalMs ?? 30000);
    this._passive = options.passive ?? false;
    this._requestTimeoutMs = options.requestTimeoutMs;
  }

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
    // a context change fetches for the new context at once, even on a closed client
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

  /** one request at a time: a forced request waits for the one in flight, an unforced one is answered by it */
  private async request(forced: boolean): Promise<void> {
    if (this._inFlight) {
      await this._inFlight;
      if (!forced) return;
    }

    if (this._dead || (!forced && Date.now() < this._nextAllowed)) {
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

  private async fetchSnapshot(): Promise<void> {
    const url = this._requestUrl;
    const started = Date.now();

    const headers: Record<string, string> = {
      ...configExtraHeaders(this._config),
      Accept: "application/json",
    };
    if (this._etag?.url === url) {
      headers["If-None-Match"] = this._etag.etag;
    }

    const controller = new AbortController();
    const timeout = this._requestTimeoutMs
      ? setTimeout(() => controller.abort(), this._requestTimeoutMs)
      : undefined;

    try {
      const response = await fetch(url, { headers, signal: controller.signal });

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

      this._etag = { url, etag: response.headers.get("etag") ?? featureSnapshotEtag(snapshot.sha) };
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
export function featureSnapshotConfig(options: FeatureSnapshotClientOptions): EdgeFeatureHubConfig {
  const config = new EdgeFeatureHubConfig();
  const interval = options.intervalMs ?? 30000;

  config.isClientEvaluated = !(options.sendContext ?? true);
  if (options.passive) {
    // evaluating a feature asks the edge service to poll (it decides whether the cache has expired)
    config.restPassive(interval);
  } else {
    config.restActive(interval);
  }
  if (options.headers) {
    config.headers(options.headers);
  }
  config.edgeServiceProvider(
    (repository, cfg) => new FeatureSnapshotEdgeService(repository, cfg, options),
  );

  return config;
}

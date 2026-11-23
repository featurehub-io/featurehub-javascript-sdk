/* eslint-disable */
import type { EdgeService } from "../edge_service";
import { SDK_VERSION } from "./common";
import { type FeatureHubConfig, fhLog } from "../feature_hub_config";
import type { InternalFeatureRepository } from "../internal_feature_repository";
import { type FeatureState, SSEResultState } from "../models";
import { contextSha } from "../context_header";

export declare class EventSource {
  static readonly CLOSED: number;
  static readonly CONNECTING: number;
  static readonly OPEN: number;

  readonly CLOSED: number;
  readonly CONNECTING: number;
  readonly OPEN: number;
  readonly url: string;
  readonly readyState: number;
  readonly withCredentials: boolean;

  onopen?: ((evt: Event) => void) | null;
  onmessage?: ((evt: MessageEvent) => void) | null;
  onerror?: ((evt: Event) => void) | null;

  constructor(url: string, eventSourceInitDict?: EventSource.EventSourceInitDict);

  addEventListener(type: string, listener: EventListener): void;
  dispatchEvent(evt: Event): boolean;
  removeEventListener(type: string, listener?: EventListener): void;
  close(): void;
}

export declare namespace EventSource {
  enum ReadyState {
    CONNECTING = 0,
    OPEN = 1,
    CLOSED = 2,
  }

  interface EventSourceInitDict {
    withCredentials?: boolean;
    // eslint-disable-next-line @typescript-eslint/ban-types
    headers?: object;
    proxy?: string;
    // eslint-disable-next-line @typescript-eslint/ban-types
    https?: object;
    rejectUnauthorized?: boolean;
  }
}

export type EventSourceProvider = (
  url: string,
  eventSourceInitDict?: EventSource.EventSourceInitDict,
) => EventSource;

/**
 * How long to wait before reconnecting after a streaming connection fails (featurehub-protocol.yaml
 * featurehub_edge.streaming.connection_errors): delay = base * backoffMultiplier^(failures - 1), capped at
 * maxDelayMs. Used where the SDK makes the reconnections itself (Node); a browser's EventSource reconnects
 * by itself.
 */
export interface SseReconnectPolicy {
  /** the base delay after a network error, a dropped stream or a response that is not an event stream */
  networkErrorDelayMs: number;
  /** the base delay after a 5xx (or 1xx/3xx) response */
  serverErrorDelayMs: number;
  backoffMultiplier: number;
  maxDelayMs: number;
  /** how many times to reconnect after consecutive failed connections before stopping for good; undefined never stops */
  maxAttempts?: number;
}

/** no reconnection is ever scheduled sooner than this */
export const minimumReconnectDelayMs = 100;

const EVENT_SOURCE_CLOSED = 2;

export class FeatureHubEventSourceClient implements EdgeService {
  private eventSource: EventSource | undefined;
  private readonly _config: FeatureHubConfig;
  private readonly _repository: InternalFeatureRepository;
  private _header: string | undefined;
  private _contextSha = "0";
  // FeatureHub has said this environment will never change again (edge.stale): we never reconnect
  private _environmentStale = false;
  private _stopped: boolean = false;
  // the connection has failed for good (a 4xx, a failure event, a browser EventSource closing, or no attempts left)
  private _failed = false;
  // consecutive failed connections, reset by a FeatureHub event on a connection that lasts past the threshold
  private _failures = 0;
  private _reconnectTimer: ReturnType<typeof setTimeout> | undefined;

  // the id of the last event received, sent as Last-Event-ID when we reconnect (for this context only)
  private _lastEventId: string | undefined;
  private _byeReceived = false;
  // an event before the short-connection threshold earns a reset of the failures, made once it passes
  private _resetDue = false;
  private _thresholdTimer: ReturnType<typeof setTimeout> | undefined;
  private _shortConnections = 0;
  private _shortConnectionsWarned = false;

  public static reconnectPolicy: SseReconnectPolicy = {
    networkErrorDelayMs: 3000,
    serverErrorDelayMs: 30000,
    backoffMultiplier: 2,
    maxDelayMs: 5 * 60 * 1000,
  };

  /**
   * True where the SDK makes every reconnection itself (Node), so it can send Last-Event-ID and back off;
   * false where the EventSource reconnects by itself (a browser, which sends Last-Event-ID for us).
   */
  public static sdkManagesReconnection = false;

  /**
   * A connection that ends sooner than this after its request did not come from Edge working normally
   * (featurehub-protocol.yaml featurehub_edge.streaming.last_event_id.short_connections). Lowered only by
   * the SDK's own tests: applications must not change it.
   * @internal
   */
  public static shortConnectionThresholdMs = 10000;

  public static eventSourceProvider: EventSourceProvider = (url, dict) => {
    // a browser EventSource cannot send headers, so the context goes in the query string, after the
    // contextSha and sdk_version (featurehub-protocol.yaml featurehub_edge.query_parameters)
    const realUrl =
      dict?.headers && "x-featurehub" in dict.headers && dict.headers["x-featurehub"]
        ? url +
          (url.includes("?") ? "&" : "?") +
          "xfeaturehub=" +
          encodeURIComponent(dict.headers["x-featurehub"] as string)
        : url;
    return new EventSource(realUrl, dict);
  };

  constructor(config: FeatureHubConfig, repository: InternalFeatureRepository) {
    this._config = config;
    this._repository = repository;
  }

  public get stopped(): boolean {
    return this._stopped;
  }

  public get lastEventId(): string | undefined {
    return this._lastEventId;
  }

  init() {
    // if this environment is stale, or the connection has failed for good, we never connect again
    if (this._environmentStale || this._failed) {
      return;
    }

    const headers: Record<string, string> = {};
    if (this._header) {
      headers["x-featurehub"] = this._header;
    }
    if (FeatureHubEventSourceClient.sdkManagesReconnection && this._lastEventId !== undefined) {
      // Edge then sends nothing that we already have
      headers["Last-Event-ID"] = this._lastEventId;
    }

    const options: EventSource.EventSourceInitDict = {};
    if (Object.keys(headers).length > 0) {
      options.headers = headers;
    }

    const url = `${this._config.url()}?contextSha=${this._contextSha}&sdk_version=${SDK_VERSION}`;

    fhLog.trace("listening at ", url);

    this.connectionStarted();
    this.eventSource = FeatureHubEventSourceClient.eventSourceProvider(url, options);

    for (const name of [
      SSEResultState.Features,
      SSEResultState.Feature,
      SSEResultState.DeleteFeature,
      SSEResultState.Bye,
      SSEResultState.Failure,
      SSEResultState.Ack,
      SSEResultState.Config,
    ]) {
      const fName = name.toString();
      this.eventSource.addEventListener(fName, (e) => {
        try {
          // as the SSE standard's last event ID: an event with no id (Edge's bye) leaves it as it was
          const id = (e as MessageEvent).lastEventId;
          if (typeof id === "string" && id.length > 0) {
            this._lastEventId = id;
          }

          if (fName === SSEResultState.Failure) {
            // FeatureHub will never give us features on this connection
            this.permanentFailure("FeatureHub sent a failure event");
            return;
          }

          // any other FeatureHub event shows the connection works
          this.connectionWorks();
          if (fName === SSEResultState.Bye) {
            this._byeReceived = true;
          }

          const data = JSON.parse((e as any).data);
          if (fName === SSEResultState.Config) {
            this.processConfig(data);
          } else {
            // ensure the environment id is set as its required in usage
            const envId = this._config.environmentId;

            if (fName === SSEResultState.Features) {
              (data as Array<FeatureState>).forEach((fs) => (fs.environmentId = envId));
            } else if (fName === SSEResultState.Feature || fName === SSEResultState.DeleteFeature) {
              (data as FeatureState).environmentId = envId;
            }

            this._repository.notify(name, data, "streaming-service");
          }
        } catch (e) {
          fhLog.error("SSE: Failed to understand result", e);
        }
      });
    }

    this.eventSource.onerror = (e: Event) => this.connectionError(e);
  }

  /** a request for a new connection (ours, or the browser's own reconnection) has just been made */
  private connectionStarted() {
    this._byeReceived = false;
    this._resetDue = false;
    this.clearThresholdTimer();

    this._thresholdTimer = setTimeout(() => {
      this._thresholdTimer = undefined;
      // the connection has lasted: it is not short, and an event it delivered resets the failures
      this._shortConnections = 0;
      this._shortConnectionsWarned = false;
      if (this._resetDue) {
        this._failures = 0;
        this._resetDue = false;
      }
    }, FeatureHubEventSourceClient.shortConnectionThresholdMs);
  }

  private connectionWorks() {
    if (this._thresholdTimer === undefined) {
      this._failures = 0;
    } else {
      // a short connection's events never reset the failures, so wait for the threshold
      this._resetDue = true;
    }
  }

  private clearThresholdTimer() {
    if (this._thresholdTimer !== undefined) {
      clearTimeout(this._thresholdTimer);
      this._thresholdTimer = undefined;
    }
  }

  /**
   * featurehub-protocol.yaml featurehub_edge.streaming.connection_errors: a 4xx means the key or environment
   * is rejected, for good. A browser's EventSource closing hides the status, so it is final too. Anything
   * else (a 5xx, a response that is not an event stream, a network error, the stream ending) is temporary:
   * the provider stays ready and we reconnect. A connection that ends after Edge's bye, having lasted past
   * the short-connection threshold, ended cleanly; any other end is a failure, counted towards the backoff
   * and the maximum attempts.
   */
  private connectionError(e: Event) {
    if (this._stopped || this._failed) {
      return;
    }

    // the node eventsource library gives the HTTP status as code (older versions as status)
    const status = (e as { code?: number }).code ?? (e as { status?: number }).status;
    const readyState = this.eventSource?.readyState;
    const short = this._thresholdTimer !== undefined;
    const clean = this._byeReceived && !short;
    this.clearThresholdTimer();

    if (status !== undefined && status >= 400 && status < 500) {
      this.permanentFailure(`FeatureHub rejected the connection (${status})`);
      return;
    }

    const sdkReconnects =
      FeatureHubEventSourceClient.sdkManagesReconnection || readyState === EVENT_SOURCE_CLOSED;

    if (
      !FeatureHubEventSourceClient.sdkManagesReconnection &&
      readyState === EVENT_SOURCE_CLOSED &&
      status === undefined
    ) {
      // a browser EventSource that has given up: it does not tell us why, so it could be a 4xx
      this.permanentFailure("the event source closed");
      return;
    }

    // the features we hold are still the latest known
    this._repository.notify(SSEResultState.Bye, null, "streaming-service");

    if (clean) {
      this._failures = 0;
    } else {
      this._failures++;
      this.countShortConnection(short);

      const maxAttempts = FeatureHubEventSourceClient.reconnectPolicy.maxAttempts;
      if (maxAttempts !== undefined && this._failures > maxAttempts) {
        this.permanentFailure(`streaming failed ${this._failures} times in a row`);
        return;
      }
    }

    if (sdkReconnects) {
      this.scheduleReconnect(clean ? undefined : status, clean ? 1 : this._failures);
    } else {
      // the browser is reconnecting by itself (sending Last-Event-ID), and that request starts now
      fhLog.trace("streaming connection lost, the browser is reconnecting", e);
      this.connectionStarted();
    }
  }

  private countShortConnection(short: boolean) {
    if (!short) {
      this._shortConnections = 0;
      return;
    }

    this._shortConnections++;
    if (this._shortConnections >= 3 && !this._shortConnectionsWarned) {
      this._shortConnectionsWarned = true;
      fhLog.warn(
        "[featurehubsdk] streaming connections to FeatureHub keep ending within seconds: something in front of " +
          "Edge (a CDN, cache or proxy) is ending its event streams early. Edge's event streams must not be cached.",
      );
    }
  }

  private permanentFailure(reason: string) {
    fhLog.error(`[featurehubsdk] ${reason}, stopping streaming.`);
    this._failed = true;
    this._repository.notify(SSEResultState.Failure, null, "streaming-service");
    this.close();
  }

  public get failed(): boolean {
    return this._failed;
  }

  /** the delay before reconnecting after the given number of consecutive failures */
  public static reconnectDelay(status: number | undefined, failures: number): number {
    const policy = FeatureHubEventSourceClient.reconnectPolicy;
    const serverError = status !== undefined && status !== 200;
    const base = serverError ? policy.serverErrorDelayMs : policy.networkErrorDelayMs;
    const delay = base * Math.pow(Math.max(policy.backoffMultiplier, 1), Math.max(failures - 1, 0));

    return Math.max(Math.min(delay, policy.maxDelayMs), minimumReconnectDelayMs);
  }

  private scheduleReconnect(status: number | undefined, failures: number) {
    this.closeEventSource();

    const delay = FeatureHubEventSourceClient.reconnectDelay(status, failures);
    fhLog.trace(
      `streaming connection ended (${status ?? "no status"}), reconnecting in ${delay}ms`,
    );

    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = undefined;
      this.init();
    }, delay);
  }

  private closeEventSource() {
    this.clearThresholdTimer();

    if (this.eventSource != null) {
      const es = this.eventSource;
      this.eventSource = undefined;
      es.close();
    }
  }

  close() {
    if (this._reconnectTimer !== undefined) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = undefined;
    }

    this.closeEventSource();
  }

  clientEvaluated(): boolean {
    return this._config.clientEvaluated();
  }

  async contextChange(header: string): Promise<void> {
    // ignore if not client evaluated
    if (!this.clientEvaluated()) {
      this._header = header;
      this._contextSha = await contextSha(header);
      // the last event id belongs to the old context: sending it would get us nothing for the new one
      this._lastEventId = undefined;

      this.close();
      this.init();
    }
  }

  poll(): Promise<void> {
    // a reconnection that is waiting out its backoff is not hurried along
    if (this.eventSource === undefined && this._reconnectTimer === undefined) {
      this.init();
    }

    return new Promise<void>((resolve) => resolve());
  }

  requiresReplacementOnHeaderChange(): boolean {
    return true;
  }

  public get environmentStale(): boolean {
    return this._environmentStale;
  }

  /**
   * A config event holding an edge.stale key, whatever its value, means the environment will never change
   * again: close the stream and never reconnect. A config without one, or whose data is not an object, is
   * ignored.
   */
  private processConfig(data: unknown) {
    if (
      data === null ||
      typeof data !== "object" ||
      Array.isArray(data) ||
      !("edge.stale" in data)
    ) {
      return;
    }

    fhLog.warn(
      "[featurehubsdk] FeatureHub says this environment is stale, you will not get any more updates.",
    );
    this._environmentStale = true;
    this._stopped = true;
    this.close();
    this._repository.markEnvironmentStale();
  }
}

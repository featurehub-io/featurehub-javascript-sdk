/* eslint-disable */
import type { EdgeService } from "../edge_service";
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
 * maxDelayMs. Only used where the SDK can see the failure (the Node client); a browser's EventSource
 * reconnects by itself.
 */
export interface SseReconnectPolicy {
  /** the base delay after a network error, a dropped stream or a response that is not an event stream */
  networkErrorDelayMs: number;
  /** the base delay after a 5xx (or 1xx/3xx) response */
  serverErrorDelayMs: number;
  backoffMultiplier: number;
  maxDelayMs: number;
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
  // the connection has failed for good (a 4xx, a failure event, or a browser EventSource closing)
  private _failed = false;
  // consecutive failed connections, reset by any FeatureHub event showing the connection works
  private _failures = 0;
  private _reconnectTimer: ReturnType<typeof setTimeout> | undefined;

  public static reconnectPolicy: SseReconnectPolicy = {
    networkErrorDelayMs: 3000,
    serverErrorDelayMs: 30000,
    backoffMultiplier: 2,
    maxDelayMs: 5 * 60 * 1000,
  };

  public static eventSourceProvider: EventSourceProvider = (url, dict) => {
    // a browser EventSource cannot send headers, so the context goes in the query string, after the
    // contextSha (featurehub-protocol.yaml featurehub_edge.query_parameters)
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

  init() {
    // if this environment is stale, or the connection has failed for good, we never connect again
    if (this._environmentStale || this._failed) {
      return;
    }

    const options: EventSource.EventSourceInitDict = {};
    if (this._header) {
      options.headers = {
        "x-featurehub": this._header,
      };
    }

    const url = `${this._config.url()}?contextSha=${this._contextSha}`;

    fhLog.trace("listening at ", url);

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
          // any FeatureHub event shows the connection works
          if (fName !== SSEResultState.Failure) {
            this._failures = 0;
          }

          const data = JSON.parse((e as any).data);
          if (fName === SSEResultState.Failure) {
            // FeatureHub will never give us features on this connection
            this.permanentFailure("FeatureHub sent a failure event");
          } else if (fName === SSEResultState.Config) {
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

  /**
   * featurehub-protocol.yaml featurehub_edge.streaming.connection_errors: a 4xx means the key or environment
   * is rejected, for good. A browser's EventSource closing hides the status, so it is final too. Anything
   * else (a 5xx, a response that is not an event stream, a network error) is temporary: the provider stays
   * ready and we reconnect, with a backoff where we have to do it ourselves.
   */
  private connectionError(e: Event) {
    if (this._stopped || this._failed) {
      return;
    }

    // the node eventsource library gives the HTTP status as code (older versions as status)
    const status = (e as { code?: number }).code ?? (e as { status?: number }).status;
    const readyState = this.eventSource?.readyState;

    if (status !== undefined && status >= 400 && status < 500) {
      this.permanentFailure(`FeatureHub rejected the connection (${status})`);
    } else if (readyState === EVENT_SOURCE_CLOSED) {
      if (status === undefined) {
        // a browser EventSource that has given up: it does not tell us why, so it could be a 4xx
        this.permanentFailure("the event source closed");
      } else {
        // the event source will not reconnect by itself after an HTTP error, so we do
        this._repository.notify(SSEResultState.Bye, null, "streaming-service");
        this.scheduleReconnect(status);
      }
    } else {
      // the event source is reconnecting by itself: the features we hold are still the latest known
      fhLog.trace("streaming connection lost, reconnecting", e);
      this._repository.notify(SSEResultState.Bye, null, "streaming-service");
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

  private scheduleReconnect(status: number | undefined) {
    this.close();
    this._failures++;

    const delay = FeatureHubEventSourceClient.reconnectDelay(status, this._failures);
    fhLog.trace(`streaming failed (${status}), reconnecting in ${delay}ms`);

    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = undefined;
      this.init();
    }, delay);
  }

  close() {
    if (this._reconnectTimer !== undefined) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = undefined;
    }

    if (this.eventSource != null) {
      const es = this.eventSource;
      this.eventSource = undefined;
      es.close();
    }
  }

  clientEvaluated(): boolean {
    return this._config.clientEvaluated();
  }

  async contextChange(header: string): Promise<void> {
    // ignore if not client evaluated
    if (!this.clientEvaluated()) {
      this._header = header;
      this._contextSha = await contextSha(header);

      if (this.eventSource !== undefined) {
        this.close();
      }

      this.init();
    }
  }

  poll(): Promise<void> {
    if (this.eventSource === undefined) {
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
  }
}

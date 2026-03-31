/* eslint-disable */
import type { EdgeService } from "../edge_service";
import { type FeatureHubConfig, fhLog } from "../feature_hub_config";
import type { InternalFeatureRepository } from "../internal_feature_repository";
import { type FeatureState, SSEResultState } from "../models";
import { Readyness } from "../featurehub_repository";

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

export class FeatureHubEventSourceClient implements EdgeService {
  private eventSource: EventSource | undefined;
  private readonly _config: FeatureHubConfig;
  private readonly _repository: InternalFeatureRepository;
  private _header: string | undefined;
  private _staleEnvironmentTimeoutId: ReturnType<typeof setTimeout> | undefined;
  private _stopped: boolean = false;

  public static eventSourceProvider: EventSourceProvider = (url, dict) => {
    const realUrl =
      dict?.headers && "x-featurehub" in dict.headers && dict.headers["x-featurehub"]
        ? url + "?xfeaturehub=" + encodeURI(dict.headers["x-featurehub"] as string)
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
    // if this environment is stale, we reject any requests to connect again
    if (this._staleEnvironmentTimeoutId) {
      return;
    }

    const options: EventSource.EventSourceInitDict = {};
    if (this._header) {
      options.headers = {
        "x-featurehub": this._header,
      };
    }

    fhLog.trace("listening at ", this._config.url());

    this.eventSource = FeatureHubEventSourceClient.eventSourceProvider(this._config.url(), options);

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
          const data = JSON.parse((e as any).data);
          fhLog.trace(`received ${fName}`, data);
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

    this.eventSource.onerror = (e: Event) => {
      if (!this._stopped) {
        // node eventsource library gives us a proper status code when the connection fails, so we should pick that up.
        const status = (e as { status?: number }).status;
        if (
          this._repository.readyness !== Readyness.Ready ||
          (status && (status > 504 || (status >= 400 && status < 500)))
        ) {
          fhLog.error(
            "Connection failed and repository not in ready state indicating persistent failure",
            e,
          );
          this._repository.notify(SSEResultState.Failure, null, "streaming-service");
          this.close();
        } else {
          fhLog.trace("refreshing connection in case of staleness", e);
        }
      }
    };
  }

  close() {
    if (this.eventSource != null) {
      const es = this.eventSource;
      this.eventSource = undefined;
      es.close();
    }
  }

  clientEvaluated(): boolean {
    return this._config.clientEvaluated();
  }

  contextChange(header: string): Promise<void> {
    // ignore if not client evaluated
    if (!this.clientEvaluated()) {
      this._header = header;

      if (this.eventSource !== undefined) {
        this.close();
      }

      this.init();
    }

    return Promise.resolve(undefined);
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

  private processConfig(data: unknown) {
    const config = data as Record<string, unknown>;
    const stale = config["edge.stale"] as number | undefined;

    if (stale) {
      this._stopped = true;
      this.close();

      this._staleEnvironmentTimeoutId = setTimeout(() => {
        clearTimeout(this._staleEnvironmentTimeoutId);
        this._staleEnvironmentTimeoutId = undefined;
        this._stopped = false;
        this.init();
      }, stale * 1000);
    }
  }
}

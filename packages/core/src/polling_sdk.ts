import type { HashAlgorithm } from "./crypto/types";
import type { EdgeService } from "./edge_service";
import { type FeatureHubConfig, fhLog } from "./feature_hub_config";
import type { InternalFeatureRepository } from "./internal_feature_repository";
import { type FeatureEnvironmentCollection, type FeatureState, SSEResultState } from "./models";

export interface PollingService {
  get frequency(): number;

  poll(): Promise<void>;

  stop(): void;

  // the promise returned is a fake promise, it is the responsibility of the outer caller to start the
  // poll again once this attribute header has changed
  attributeHeader(header: string): Promise<void>;

  busy: boolean;
}

export type FeaturesFunction = (environments: Array<FeatureEnvironmentCollection>) => void;
export type PromiseLikeFunction = (value: void | PromiseLike<void>) => void;
export type RejectLikeFunction = (response?: unknown) => void;

export interface PromiseLikeData {
  resolve: PromiseLikeFunction;
  reject: RejectLikeFunction;
}

export type CryptoProvider = (algorithm: HashAlgorithm, data: string) => Promise<string>;

export abstract class PollingBase implements PollingService {
  protected url: string;
  protected _frequency: number;
  protected _callback: FeaturesFunction;
  protected _stopped = false;
  protected _header?: string;
  protected _shaHeader: string;
  protected _etag: string | undefined | null;
  protected _busy = false;
  protected _outstandingPromises: Array<PromiseLikeData> = [];
  protected readonly _createBase64UrlSafeHash: CryptoProvider;

  protected constructor(
    url: string,
    frequency: number,
    createBase64UrlSafeHash: CryptoProvider,
    callback: FeaturesFunction,
  ) {
    this.url = url;
    this._frequency = frequency;
    this._shaHeader = "0";
    this._callback = callback;
    this._busy = false;
    this._createBase64UrlSafeHash = createBase64UrlSafeHash;
  }

  async attributeHeader(header: string): Promise<void> {
    this._header = header;
    this._shaHeader =
      header === undefined || header.length === 0
        ? "0"
        : await this._createBase64UrlSafeHash("sha256", header);
  }

  public stop(): void {
    this._stopped = true;
  }

  public get frequency(): number {
    return this._frequency;
  }

  public abstract poll(): Promise<void>;

  /**
   * Allow the cache control settings on the server override this polling _frequency
   * @param cacheHeader
   */
  public parseCacheControl(cacheHeader: string | undefined | null) {
    if (cacheHeader) {
      const maxAge = cacheHeader.match(/max-age=(\d+)/);
      if (maxAge) {
        const newFreq = parseInt(maxAge[1]!, 10);
        if (newFreq > 0) {
          this._frequency = newFreq * 1000;
        }
      }
    }
  }

  // this is a dead  function but if we don't include it
  // then node will fail

  protected async delayTimer(): Promise<void> {
    return new Promise<void>((resolve) => {
      resolve();
    });
  }

  public get busy() {
    return this._busy;
  }

  protected resolveOutstanding(): void {
    const outstanding = [...this._outstandingPromises];
    this._outstandingPromises = [];
    outstanding.forEach((e) => e.resolve());
  }

  public rejectOutstanding(result?: any) {
    const outstanding = [...this._outstandingPromises];
    this._outstandingPromises = [];
    outstanding.forEach((e) => e.reject(result));
  }
}

export interface PollingOptions {
  timeout?: number;
}

export type PollingClientProvider = (
  options: PollingOptions,
  url: string,
  frequency: number,
  callback: FeaturesFunction,
) => PollingService;

export class FeatureHubPollingClient implements EdgeService {
  private readonly _frequency: number;
  private readonly _url: string;
  private _repository: InternalFeatureRepository;
  private _pollingService: PollingService | undefined;
  private readonly _options: PollingOptions;
  private _startable: boolean;
  private readonly _config: FeatureHubConfig;
  private _xHeader: string | undefined;
  private _pollPromiseResolve: ((value: PromiseLike<void> | void) => void) | undefined;
  private _pollPromiseReject: ((reason?: any) => void) | undefined;
  private _currentTimer: any;

  public static pollingClientProvider: PollingClientProvider;

  constructor(
    repository: InternalFeatureRepository,
    config: FeatureHubConfig,
    frequency: number,
    options: PollingOptions = {},
  ) {
    this._startable = true;
    this._frequency = frequency;
    this._repository = repository;
    this._options = options;
    this._config = config;
    this._url =
      config.getHost() +
      "features?" +
      config
        .getApiKeys()
        .map((e) => "apiKey=" + encodeURIComponent(e))
        .join("&");
  }

  private _initService(): void {
    if (this._pollingService === undefined && this._startable) {
      this._pollingService = FeatureHubPollingClient.pollingClientProvider(
        this._options,
        this._url,
        this._frequency,
        (e) => this.response(e),
      );

      fhLog.trace(`featurehub: initialized polling client to ${this._url}`);
    }
  }

  public async contextChange(header: string): Promise<void> {
    if (!this._config.clientEvaluated()) {
      if (this._xHeader !== header) {
        this._xHeader = header;

        this._initService();

        if (this._pollingService) {
          await this._pollingService.attributeHeader(header);
        }

        this._restartTimer();
      }
    }

    return new Promise<void>((resolve) => resolve());
  }

  public clientEvaluated(): boolean {
    return this._config.clientEvaluated();
  }

  public requiresReplacementOnHeaderChange(): boolean {
    return false;
  }

  public close(): void {
    this.stop();
  }

  private stop() {
    fhLog.trace("polling stopping");
    // stop the timeout if one is going on
    if (this._currentTimer) {
      clearTimeout(this._currentTimer);
      this._currentTimer = undefined;
    }

    if (this._pollPromiseReject !== undefined) {
      this._pollPromiseReject("Never came live");
    }

    // stop the polling service and clear it
    this._pollingService?.stop();
    this._pollingService = undefined;
  }

  public poll(): Promise<void> {
    if (this._pollPromiseResolve !== undefined || this._pollingService?.busy) {
      return new Promise<void>((resolve) => resolve());
    }

    if (!this._startable) {
      return new Promise<void>((_, reject) => reject());
    }

    this._initService();

    return new Promise<void>((resolve, reject) => {
      this._pollPromiseReject = reject;
      this._pollPromiseResolve = resolve;

      this._restartTimer();
    });
  }

  public get canStart() {
    return this._startable;
  }

  public get pollingFrequency(): undefined | number {
    return this._pollingService?.frequency;
  }

  public get active(): boolean {
    return this._pollingService?.busy || this._currentTimer !== undefined;
  }

  public get awaitingFirstSuccess(): boolean {
    return this._pollPromiseReject !== undefined;
  }

  private _restartTimer() {
    if (this._pollingService === undefined || this._pollingService?.busy || !this._startable) {
      return;
    }

    fhLog.trace("polling restarting");

    if (this._currentTimer) {
      clearTimeout(this._currentTimer);
      this._currentTimer = undefined;
    }

    this._pollFunc();
  }

  private _pollFunc() {
    this._pollingService!.poll()
      .then(() => {
        fhLog.trace("poll successful");

        // set the next one going before we resolve as otherwise the test will fail
        this._readyNextPoll();

        if (this._pollPromiseResolve !== undefined) {
          try {
            this._pollPromiseResolve();
          } catch (e) {
            fhLog.error("Failed to process resolve", e);
          }
        }

        this._pollPromiseReject = undefined;
        this._pollPromiseResolve = undefined;
      })
      .catch((status) => {
        fhLog.trace("poll failed", status);
        if (status === 404 || status == 400) {
          if (status == 404) {
            fhLog.error("The API Key provided does not exist, stopping polling.");
          }

          this._repository.notify(SSEResultState.Failure, null);
          this._startable = false;

          this.stop();

          if (this._pollPromiseReject) {
            try {
              this._pollPromiseReject(status);
            } catch (e) {
              fhLog.error("Failed to process reject", e);
            }
          }

          this._pollPromiseReject = undefined;
          this._pollPromiseResolve = undefined;
        } else {
          this._readyNextPoll();

          if (status == 503) {
            fhLog.log("The backend is not ready, waiting for the next poll.");
          }
        }
      })
      .finally(() => {});
  }

  private _readyNextPoll() {
    if (this._pollingService && this._pollingService.frequency > 0) {
      // in case we got a 404, and it was shut down
      fhLog.trace("starting timer for poll", this._pollingService.frequency);
      this._currentTimer = setTimeout(() => this._restartTimer(), this._pollingService.frequency);
    } else {
      fhLog.trace(
        "no polling service or 0 frequency, stopping polling.",
        this._pollingService === undefined,
        this._pollingService?.frequency,
      );
    }
  }

  private response(environments: Array<FeatureEnvironmentCollection>): void {
    if (environments.length === 0) {
      this._startable = false;
      this.stop();
      this._repository.notify(SSEResultState.Failure, null);
    } else {
      const features = new Array<FeatureState>();

      environments.forEach((e) => {
        if (e.features!.length > 0) {
          // set the environment id so each feature knows which environment it comes from
          e.features!.forEach((f) => {
            f.environmentId = e.id;
          });
          features.push(...e.features!);
        }
      });

      this._repository.notify(SSEResultState.Features, features);
    }
  }
}

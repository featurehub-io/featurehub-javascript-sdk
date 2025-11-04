import { createBase64UrlSafeHash } from "./crypto";
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

interface PromiseLikeData {
  resolve: PromiseLikeFunction;
  reject: RejectLikeFunction;
}

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

  protected constructor(url: string, frequency: number, callback: FeaturesFunction) {
    this.url = url;
    this._frequency = frequency;
    this._shaHeader = "0";
    this._callback = callback;
    this._busy = false;
  }

  async attributeHeader(header: string): Promise<void> {
    this._header = header;
    this._shaHeader =
      header === undefined || header.length === 0
        ? "0"
        : await createBase64UrlSafeHash("sha256", header);
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
    const maxAge = cacheHeader?.match(/max-age=(\d+)/);
    if (maxAge) {
      const newFreq = parseInt(maxAge[1]!, 10);
      if (newFreq > 0) {
        this._frequency = newFreq * 1000;
      }
    }
  }

  // this is a dead  function but if we don't include it
  // then node will fail

  protected async delayTimer(): Promise<void> {
    return new Promise((resolve) => {
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

export interface NodejsOptions {
  timeout?: number;
}

export interface BrowserOptions {
  timeout?: number;
}

/**
 * This should never be used directly but we are exporting it because we need it
 */
export class BrowserPollingService extends PollingBase implements PollingService {
  private localStorageLastUrl?: string;

  // override this in React Native - for example use AsyncStorage
  static localStorageRequestor = () => {
    if (window.localStorage) {
      return localStorage;
    }

    // maybe in React Native or other similar browsery thing.
    return {
      getItem: () => null,
      setItem: () => {},
    };
  };

  constructor(
    _options: BrowserOptions,
    url: string,
    frequency: number,
    callback: FeaturesFunction,
  ) {
    super(url, frequency, callback);
  }

  private loadLocalState(url: string) {
    if (url !== this.localStorageLastUrl) {
      this.localStorageLastUrl = url;

      const storedData = BrowserPollingService.localStorageRequestor().getItem(url);
      if (storedData) {
        try {
          const data = JSON.parse(storedData);
          if (data.e) {
            // save space with short name
            this._callback(data.e as Array<FeatureEnvironmentCollection>);
          }
        } catch (_) {
          // ignore exception
        }
      }
    }
  }

  public async poll(): Promise<void> {
    if (this._busy) {
      return new Promise((resolve, reject) => {
        this._outstandingPromises.push({ resolve: resolve, reject: reject } as PromiseLikeData);
      });
    }

    if (this._stopped) {
      return new Promise((resolve) => {
        resolve();
      });
    }

    // check in case we have a cached copy of it
    this.loadLocalState(this.url);

    const headers: Record<string, string> = {
      "Content-type": "application/json",
      ...(this._etag ? { "if-none-match": this._etag } : {}),
      ...(this._header ? { "x-featurehub": this._header } : {}),
    };

    const response = await fetch(`${this.url}&contextSha=${this._shaHeader}`, { headers });

    if (response.status === 304) {
      this._busy = false;
      this.resolveOutstanding();
      return;
    } else if (!response.ok) {
      this._busy = false;
      this.rejectOutstanding(response.status);
      throw new Error(`Failed to fetch features: ${response.statusText}`);
    }

    this._etag = response.headers.get("etag");
    this.parseCacheControl(response.headers.get("cache-control"));

    const environments = JSON.parse(await response.text()) as FeatureEnvironmentCollection[];

    try {
      BrowserPollingService.localStorageRequestor().setItem(
        this.url,
        JSON.stringify({ e: environments }),
      );
    } catch (_) {
      fhLog.error("featurehub: unable to cache features");
    }

    this._callback(environments);
    this._stopped = response.status === 236;
    this._busy = false;
    this.resolveOutstanding();
  }
}

export type PollingClientProvider = (
  options: BrowserOptions,
  url: string,
  frequency: number,
  callback: FeaturesFunction,
) => PollingService;

export class FeatureHubPollingClient implements EdgeService {
  private readonly _frequency: number;
  private readonly _url: string;
  private _repository: InternalFeatureRepository;
  private _pollingService: PollingService | undefined;
  private readonly _options: BrowserOptions | NodejsOptions;
  private _startable: boolean;
  private readonly _config: FeatureHubConfig;
  private _xHeader: string | undefined;
  private _pollPromiseResolve: ((value: PromiseLike<void> | void) => void) | undefined;
  private _pollPromiseReject: ((reason?: any) => void) | undefined;
  private _currentTimer: any;

  public static pollingClientProvider: PollingClientProvider = (opt, url, freq, callback) =>
    new BrowserPollingService(opt, url, freq, callback);

  constructor(
    repository: InternalFeatureRepository,
    config: FeatureHubConfig,
    frequency: number,
    options: BrowserOptions | NodejsOptions = {},
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

import type { HashAlgorithm } from "../crypto/types";
import type { EdgeService } from "../edge_service";
import { type FeatureHubConfig, fhLog } from "../feature_hub_config";
import type { InternalFeatureRepository } from "../internal_feature_repository";
import { type FeatureEnvironmentCollection, type FeatureState, SSEResultState } from "../models";
import type { FetchRequestOptions, ModifyRequestFunction } from "./common";

export interface PollingService {
  get frequency(): number;

  poll(): Promise<void>;

  stop(): void;
  get stopped(): boolean;

  // the promise returned is a fake promise, it is the responsibility of the outer caller to start the
  // poll again once this attribute header has changed
  attributeHeader(header: string): Promise<void>;

  busy: boolean;

  awaitingFirstPollResult: boolean;
}

export type FeaturesFunction = (environments: Array<FeatureEnvironmentCollection>) => void;
export type PromiseLikeFunction = (value: void | PromiseLike<void>) => void;
export type RejectLikeFunction = (response?: unknown) => void;

export interface PromiseLikeData {
  resolve: PromiseLikeFunction;
  reject: RejectLikeFunction;
}

export interface RestOptions {
  timeout?: number;
  active?: boolean;
  modifyRequestFunction?: ModifyRequestFunction;
}

export type CryptoProvider = (algorithm: HashAlgorithm, data: string) => Promise<string>;

export class PollingBase implements PollingService {
  protected url: string;
  protected _frequency: number;
  protected _callback: FeaturesFunction;
  protected _stopped = false;
  protected _header?: string;
  protected _shaHeader: string;
  protected _etag: string | undefined | null;
  protected _busy = false;
  protected _awaitingFirstPollResult = true;
  protected _outstandingPromises: Array<PromiseLikeData> = [];
  protected readonly _createBase64UrlSafeHash: CryptoProvider;
  private readonly uri: URL;
  private readonly _options: RestOptions;

  protected constructor(
    url: string,
    frequency: number,
    createBase64UrlSafeHash: CryptoProvider,
    options: RestOptions,
    callback: FeaturesFunction,
  ) {
    this.url = url;
    this._frequency = frequency;
    fhLog.trace(`Created polling client with url ${this.url} and frequency ${this._frequency}`);
    this._shaHeader = "0";
    this._callback = callback;
    this._busy = false;
    this._createBase64UrlSafeHash = createBase64UrlSafeHash;
    this.uri = new URL(this.url);
    this._options = options;
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
    this.rejectOutstanding("stopped");
  }

  public get stopped(): boolean {
    return this._stopped;
  }

  public get frequency(): number {
    return this._frequency;
  }

  /** return true if you want to abort at this point */
  public async preload(_req: FetchRequestOptions, _url: string): Promise<boolean> {
    return false;
  }

  /** return true if you want to abort at this point */
  public async postload(_response: Response): Promise<boolean> {
    return false;
  }

  /** return true if you want to abort the delivery of the features at this point, remaining will continue */
  public async postdecode(_environments: FeatureEnvironmentCollection[]): Promise<boolean> {
    return false;
  }

  public async poll(): Promise<void> {
    if (this._busy) {
      return new Promise<void>((resolve, reject) => {
        this._outstandingPromises.push({ resolve: resolve, reject: reject } as PromiseLikeData);
      });
    }

    if (this._stopped) {
      return new Promise<void>((resolve) => resolve());
    }

    this._busy = true;

    const headers: Record<string, string> = this._header
      ? ({ "x-featurehub": this._header } as Record<string, string>)
      : {};

    if (this._etag) headers["if-none-match"] = this._etag;

    // we are not specifying the type as it forces us to bring in one of http or https
    const req: FetchRequestOptions = {
      method: "GET",
      headers: headers,
      protocol: this.uri.protocol,
      host: this.uri.host,
      hostname: this.uri.hostname,
      port: this.uri.port,
      path: this.uri.pathname,
      search: `${this.uri.search}&contextSha=${this._shaHeader}`,
      timeout: this._options.timeout || 8000,
    };

    this._options.modifyRequestFunction?.(req);

    const url = `${req.protocol}//${req.host}${req.path}${req.search}`;

    if (await this.preload(req, url)) {
      return;
    }

    // Create AbortController for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), req.timeout || 8000);

    try {
      const response = await fetch(url, {
        headers: headers,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (await this.postload(response)) {
        return;
      }

      if (!response.ok && response.status !== 304) {
        this.rejectOutstanding(response.status);
        throw new Error(`Failed to fetch features: ${response.statusText}`, {
          cause: response.status,
        });
      }

      this.parseCacheControl(response.headers.get("cache-control"));

      if (response.status === 304) {
        this.resolveOutstanding();
        return;
      }

      this._etag = response.headers.get("etag");

      const environments = JSON.parse(await response.text()) as FeatureEnvironmentCollection[];
      if (!(await this.postdecode(environments))) {
        this._callback(environments);
      }

      this._stopped = response.status === 236;
      this.resolveOutstanding();
    } catch (e) {
      this.rejectOutstanding(e);
      throw e;
    } finally {
      this._awaitingFirstPollResult = false;
    }
  }

  /**
   * Allow the cache control settings on the server override this polling _frequency
   * @param cacheHeader
   */
  public parseCacheControl(cacheHeader: string | undefined | null) {
    fhLog.trace(`cache header is ${cacheHeader}`);
    if (cacheHeader) {
      const maxAge = cacheHeader.match(/max-age=(\d+)/);
      fhLog.trace(`max age is ${maxAge}`);
      if (maxAge) {
        const newFreq = parseInt(maxAge[1]!, 10);
        fhLog.trace(`cache header tried to set new freq to ${newFreq}`);
        if (newFreq > 0) {
          this._frequency = newFreq * 1000;
        }
      }
    }
  }

  public get busy() {
    return this._busy;
  }

  public get awaitingFirstPollResult() {
    return this._awaitingFirstPollResult;
  }

  protected resolveOutstanding(): void {
    const outstanding = [...this._outstandingPromises];
    this._outstandingPromises = [];
    this._busy = false;

    outstanding.forEach((e) => e.resolve());
  }

  public rejectOutstanding(result?: unknown) {
    const outstanding = [...this._outstandingPromises];
    this._outstandingPromises = [];
    this._busy = false;
    outstanding.forEach((e) => e.reject(result));
  }
}

export type PollingClientProvider = (
  options: RestOptions,
  url: string,
  frequency: number,
  callback: FeaturesFunction,
) => PollingService;

export class FeatureHubPollingClient implements EdgeService {
  private _frequency: number;
  private readonly _url: string;
  private _repository: InternalFeatureRepository;
  private _pollingService: PollingService | undefined;
  private readonly _options: RestOptions;
  private _startable: boolean;
  private readonly _config: FeatureHubConfig;
  private _xHeader: string | undefined;
  private _currentTimer: ReturnType<typeof setTimeout> | undefined;
  private _whenPollingCacheExpires: number;

  public static pollingClientProvider: PollingClientProvider;

  constructor(
    repository: InternalFeatureRepository,
    config: FeatureHubConfig,
    frequency: number,
    options: RestOptions = {},
  ) {
    this._startable = true;
    this._frequency = frequency;
    this._repository = repository;
    this._options = options;
    if (this._options.active === undefined) {
      this._options.active = true;
    }
    this._config = config;
    this._url =
      config.getHost() +
      "features?" +
      config
        .getApiKeys()
        .map((e) => "apiKey=" + encodeURIComponent(e))
        .join("&");

    this._whenPollingCacheExpires = Date.now() - 100;
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

        return new Promise<void>((resolve, reject) => {
          this._pollFunc(resolve, reject);
        });
      }
    }

    return new Promise<void>((resolve) => resolve());
  }

  private _cancelTimer() {
    // stop the timeout if one is going on
    if (this._currentTimer) {
      clearTimeout(this._currentTimer);
      this._currentTimer = undefined;
    }
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
    this._cancelTimer();

    // stop the polling service and clear it
    this._pollingService?.stop();
    this._pollingService = undefined;
  }

  public poll(fromUsage?: boolean): Promise<void> {
    const isFromUsage = fromUsage || false;

    // we are active but the poll request came from usage and there is already a timer or there is no actual polling service or its busy
    // we are active polling and someone has already requested a poll and the timer is going OR
    // we are passive polling and the cache hasn't expired yet
    // or its from usage, we are passive polling and the polling service is already doing something
    if (
      (this._options.active && isFromUsage && (this._currentTimer || this._pollingService?.busy)) ||
      (!this._options.active && this._whenPollingCacheExpires > Date.now()) ||
      (isFromUsage && !this._options.active && this._pollingService?.busy)
    ) {
      return new Promise<void>((resolve) => resolve());
    }

    if (!this._options.active && this._whenPollingCacheExpires < Date.now()) {
      fhLog.trace(`cache has expired, allowing call ${isFromUsage}`);
    }

    // if we can't start because the server has told us we aren't allowed to
    if (!this._startable) {
      return new Promise<void>((_, reject) => reject());
    }

    // go create a polling service if we don't have one already
    this._initService();

    return new Promise<void>((resolve, reject) => {
      const forcePoll = this._options.active || this._whenPollingCacheExpires < Date.now();

      if (forcePoll) {
        this._pollFunc(resolve, reject);
      } else {
        resolve();
      }
    });
  }

  public get canStart() {
    return this._startable;
  }

  public get pollingFrequency(): undefined | number {
    return this._pollingService?.frequency;
  }

  public get isTimerSet(): boolean {
    return this._currentTimer !== undefined;
  }

  public get nextCacheExpiry(): undefined | number {
    return this._options.active ? undefined : this._whenPollingCacheExpires;
  }

  public get active(): boolean {
    return this._pollingService?.busy || this._currentTimer !== undefined;
  }

  public get awaitingFirstSuccess(): boolean {
    return this._pollingService?.awaitingFirstPollResult || false;
  }

  private _pollFunc(
    resolve?: (value: void | PromiseLike<void>) => void,
    reject?: (reason?: unknown) => void,
  ) {
    // only be true for active polling
    this._cancelTimer();

    // we will only call readyNextPoll if this was the FIRST poll being requested, the polling service
    // can stack up callers and call them all back and we don't want readyNextPoll being triggered multiple times
    const pollingBusy = this._pollingService?.busy || false;
    console.log("polling busy", pollingBusy);
    this._pollingService!.poll()
      .then(() => {
        fhLog.trace("poll successful");

        // set the next one going before we resolve as otherwise the test will fail
        if (!pollingBusy) {
          this._readyNextPoll();
        }
        fhLog.trace("next polled finished");
        if (resolve !== undefined) {
          try {
            resolve();
          } catch (e) {
            fhLog.error("Failed to process resolve", e);
          }
        }
      })
      .catch((status) => {
        fhLog.trace("poll failed", status);
        if (status === 404 || status == 400) {
          if (status == 404) {
            fhLog.error("The API Key provided does not exist, stopping polling.");
          }

          this._repository.notify(SSEResultState.Failure, null, "polling-service");
          this._startable = false;

          this.stop();

          if (reject) {
            try {
              reject(status);
            } catch (e) {
              fhLog.error("Failed to process reject", e);
            }
          }
        } else {
          if (!pollingBusy) {
            this._readyNextPoll(resolve, reject);
          }

          if (status == 503) {
            fhLog.log("The backend is not ready, waiting for the next poll.");
          }
        }
      });
  }

  private _readyNextPoll(
    resolve?: (value: void | PromiseLike<void>) => void,
    reject?: (reason?: unknown) => void,
  ) {
    const frequency = this._pollingService?.frequency || this._frequency;

    if (frequency > 0 && this._options.active) {
      // in case we got a 404, and it was shut down
      fhLog.trace("starting timer for poll", frequency);
      this._currentTimer = setTimeout(() => this._pollFunc(resolve, reject), frequency);
    } else if (this._options.active) {
      fhLog.trace(
        `no polling service or 0 frequency, stopping polling. defined? ${this._pollingService} frequency: ${frequency}`,
      );
    } else {
      // passive polling
      this._whenPollingCacheExpires = Date.now() + frequency;
      fhLog.trace(`passive polling means cache will expire in ${frequency}ms`);
    }

    this._frequency = frequency;
  }

  private response(environments: Array<FeatureEnvironmentCollection>): void {
    if (environments.length === 0) {
      fhLog.trace(`There are no environments for this apikey, stopping polling.`);
      this._startable = false;
      this.stop();
      this._repository.notify(SSEResultState.Failure, null, "polling-service");
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

      this._repository.notify(SSEResultState.Features, features, "polling-service");
    }
  }
}

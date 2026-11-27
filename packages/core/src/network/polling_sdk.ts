import { contextSha, type CryptoProvider } from "../context_header";
import type { EdgeService } from "../edge_service";
import {
  configExtraHeaders,
  configHostQuery,
  type FeatureHubConfig,
  fhLog,
  testPollingEnabled,
} from "../feature_hub_config";
import type { InternalFeatureRepository } from "../internal_feature_repository";
import { type FeatureEnvironmentCollection, type FeatureState, SSEResultState } from "../models";
import { type FetchRequestOptions, type ModifyRequestFunction, SDK_VERSION } from "./common";

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

  // FeatureHub answered 236: the environment is stale and nothing more will arrive
  readonly environmentStale: boolean;
}

export type FeaturesFunction = (
  environments: Array<FeatureEnvironmentCollection>,
  source?: string,
) => void;
export type PromiseLikeFunction = (value: void | PromiseLike<void>) => void;
export type RejectLikeFunction = (response?: unknown) => void;

export interface PromiseLikeData {
  resolve: PromiseLikeFunction;
  reject: RejectLikeFunction;
  // the context a caller was waiting for, so a request for an earlier context does not answer it
  contextGeneration?: number;
}

export interface RestOptions {
  timeout?: number;
  active?: boolean;
  modifyRequestFunction?: ModifyRequestFunction;
  // the application's extra headers, fetched for each poll (without any clashing with the SDK's own)
  extraHeaders?: () => Record<string, string>;
}

export type { CryptoProvider };

export class PollingBase implements PollingService {
  protected url: string;
  protected _frequency: number;
  // the interval the application configured, which applies whenever the server sets no pollInterval
  protected readonly _configuredFrequency: number;
  protected _callback: FeaturesFunction;
  protected _stopped = false;
  protected _environmentStale = false;
  protected _header?: string;
  protected _shaHeader: string;
  protected _etag: string | undefined | null;
  // increases on every context change, so a response to a request made for an earlier context is recognised
  protected _contextGeneration = 0;
  protected _busy = false;
  protected _awaitingFirstPollResult = true;
  protected _outstandingPromises: Array<PromiseLikeData> = [];
  protected readonly _createBase64UrlSafeHash: CryptoProvider;
  private readonly uri: URL;
  private readonly _options: RestOptions;

  protected constructor(
    url: string,
    frequency: number,
    // hashes the x-featurehub header into the contextSha; it MUST return lowercase hex
    createBase64UrlSafeHash: CryptoProvider,
    options: RestOptions,
    callback: FeaturesFunction,
  ) {
    this.url = url;
    this._frequency = frequency;
    this._configuredFrequency = frequency;
    fhLog.trace(`Created polling client with url ${this.url} and frequency ${this._frequency}`);
    this._shaHeader = "0";
    this._callback = callback;
    this._busy = false;
    this._createBase64UrlSafeHash = createBase64UrlSafeHash;
    this.uri = new URL(this.url);
    this._options = options;
  }

  async attributeHeader(header: string): Promise<void> {
    if (header !== this._header) {
      // an ETag belongs to the context it was fetched for: a 304 for the old context's ETag would leave
      // the repository holding the old context's features
      this._etag = undefined;
      this._contextGeneration++;
    }

    this._header = header;
    this._shaHeader = await contextSha(header, this._createBase64UrlSafeHash);
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
      // the request in flight answers this caller too, unless the context changes before it returns
      return new Promise<void>((resolve, reject) => {
        this._outstandingPromises.push({
          resolve: resolve,
          reject: reject,
          contextGeneration: this._contextGeneration,
        });
      });
    }

    if (this._stopped) {
      return new Promise<void>((resolve) => resolve());
    }

    this._busy = true;

    const requestGeneration = this._contextGeneration;
    // the application's headers first, so the SDK's own protocol headers win
    const headers: Record<string, string> = { ...(this._options.extraHeaders?.() ?? {}) };
    if (this._header) headers["x-featurehub"] = this._header;
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
      // featurehub-protocol.yaml featurehub_edge.query_parameters: apiKey..., contextSha, sdk_version
      search: `${this.uri.search}&contextSha=${this._shaHeader}&sdk_version=${SDK_VERSION}`,
      timeout: this._options.timeout || 8000,
    };

    this._options.modifyRequestFunction?.(req);

    // the SDK's own protocol header wins over an application's header of the same name
    if (this._header) {
      req.headers["x-featurehub"] = this._header;
    }

    const url = `${req.protocol}//${req.host}${req.path}${req.search}`;

    if (await this.preload(req, url)) {
      this.resolveOutstanding(requestGeneration);
      return;
    }

    // Create AbortController for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), req.timeout || 8000);

    try {
      const response = await fetch(url, {
        headers: req.headers,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (await this.postload(response)) {
        this.resolveOutstanding(requestGeneration);
        return;
      }

      if (!response.ok && response.status !== 304) {
        throw new PollingError(response.status, response.statusText);
      }

      if (response.status === 304) {
        // a 304 has no body, so it leaves the interval as it is
        fhLog.trace("304 - no updates");
        this.resolveOutstanding(requestGeneration);
        return;
      }

      const environments = PollingBase.decodeEnvironments(await response.text());

      // the context changed while this request was in flight: its features (and ETag) are for the old
      // context, and the callers waiting on it are answered by a request for the new one
      if (requestGeneration === this._contextGeneration) {
        this.applyPollInterval(environments);

        // only keep the ETag of a body we decoded (otherwise the server could answer 304 for good)
        this._etag = response.headers.get("etag");

        if (!(await this.postdecode(environments))) {
          this._callback(environments);
        }
      }

      if (response.status === 236) {
        this._stopped = true;
        this._environmentStale = true;
        fhLog.warn(
          "[featurehubsdk] FeatureHub says this environment is stale, you will not get any more updates.",
        );
      }
      this.resolveOutstanding(requestGeneration);
    } catch (e) {
      this.rejectOutstanding(e, requestGeneration);
      throw e;
    } finally {
      // if this has already been done, it is fine
      clearTimeout(timeoutId);

      this._awaitingFirstPollResult = false;
    }
  }

  /**
   * Decodes a 200 or 236 body, which FeatureHub always sends as an array of environments, each with an
   * array of features (absent or null meaning none). Anything else came from something between us and Edge
   * (a proxy, a gateway) and is an error, as a network error is: nothing is applied and the next poll retries.
   */
  public static decodeEnvironments(body: string): FeatureEnvironmentCollection[] {
    const decoded: unknown = JSON.parse(body);

    if (!Array.isArray(decoded)) {
      throw new Error("FeatureHub responded with something other than an array of environments");
    }

    return decoded
      .filter((e) => e !== null && e !== undefined)
      .map((e) => {
        if (typeof e !== "object" || Array.isArray(e)) {
          throw new Error("FeatureHub responded with an environment that is not an object");
        }

        const env = e as FeatureEnvironmentCollection;
        if (env.features !== undefined && env.features !== null && !Array.isArray(env.features)) {
          throw new Error(
            "FeatureHub responded with an environment whose features are not an array",
          );
        }

        return { ...env, features: env.features ?? [] };
      });
  }

  /**
   * featurehub-protocol.yaml featurehub_edge.polling.poll_interval: each environment of a 200 or 236 body may
   * carry a pollInterval, in whole seconds. One that is absent, null, not a whole number or below the
   * minimum interval is ignored (not raised); the smallest of the rest replaces the configured interval,
   * shorter or longer. With none left the configured interval applies again, and with a configured interval
   * of 0 (poll once) nothing changes. Cache-Control is never read for this: it is for HTTP caches.
   */
  public applyPollInterval(environments: FeatureEnvironmentCollection[]): void {
    if (this._configuredFrequency === 0) {
      return;
    }

    // test mode uses any pollInterval of at least a second (polling_transport.interval.test_mode)
    const minimumSeconds = testPollingEnabled() ? 1 : PollingBase.minimumIntervalMs / 1000;
    const intervals = environments
      .map((e) => e.pollInterval)
      .filter(
        (seconds): seconds is number =>
          typeof seconds === "number" && Number.isInteger(seconds) && seconds >= minimumSeconds,
      );

    this._frequency =
      intervals.length > 0 ? Math.min(...intervals) * 1000 : this._configuredFrequency;
    fhLog.trace(`polling interval is now ${this._frequency}ms`);
  }

  /**
   * The minimum polling interval: a shorter configured one is a validation error, and a FeatureHub
   * pollInterval below it is ignored.
   *
   * Decision: this is deliberately a public static that an application can change. The protocol says
   * applications must not be able to lower it (featurehub-protocol.yaml polling_transport.interval.minimum);
   * this SDK accepts that deviation, as anyone changing it has chosen to.
   */
  public static minimumIntervalMs = 5000;

  public get busy() {
    return this._busy;
  }

  public get environmentStale(): boolean {
    return this._environmentStale;
  }

  public get awaitingFirstPollResult() {
    return this._awaitingFirstPollResult;
  }

  /**
   * Answers the callers waiting on the request made for requestGeneration. Callers that arrived after the
   * context changed are given a fresh request for the new context instead.
   */
  protected resolveOutstanding(requestGeneration?: number): void {
    const [answered, later] = this.takeOutstanding(requestGeneration);
    answered.forEach((e) => e.resolve());
    this.repollFor(later);
  }

  public rejectOutstanding(result?: unknown, requestGeneration?: number) {
    const [answered, later] = this.takeOutstanding(requestGeneration);
    answered.forEach((e) => e.reject(result));
    this.repollFor(later);
  }

  private takeOutstanding(
    requestGeneration?: number,
  ): [Array<PromiseLikeData>, Array<PromiseLikeData>] {
    const outstanding = this._outstandingPromises;
    this._outstandingPromises = [];
    this._busy = false;

    if (requestGeneration === undefined || this._stopped) {
      return [outstanding, []];
    }

    const isLater = (p: PromiseLikeData) =>
      p.contextGeneration !== undefined && p.contextGeneration !== requestGeneration;

    return [outstanding.filter((p) => !isLater(p)), outstanding.filter(isLater)];
  }

  private repollFor(later: Array<PromiseLikeData>) {
    if (later.length > 0) {
      const next = this.poll();
      later.forEach((p) => next.then(p.resolve, p.reject));
    }
  }
}

/** a poll that FeatureHub (or something in front of it) answered with an HTTP error status */
export class PollingError extends Error {
  public readonly status: number;

  constructor(status: number, statusText?: string) {
    super(`Failed to fetch features: ${status} ${statusText ?? ""}`.trim(), { cause: status });
    this.status = status;
  }
}

/** the HTTP status a poll failed with, whether it was rejected with a PollingError or a bare status */
export function pollingFailureStatus(failure: unknown): number | undefined {
  if (typeof failure === "number") return failure;
  if (failure instanceof PollingError) return failure.status;
  if (failure instanceof Error && typeof failure.cause === "number") return failure.cause;
  return undefined;
}

export type PollingClientProvider = (
  options: RestOptions,
  url: string,
  frequency: number,
  callback: FeaturesFunction,
) => PollingService;

export class FeatureHubPollingClient implements EdgeService {
  private _frequency: number;
  // 0 means poll once and stop, in both modes (a pollInterval never changes that)
  private readonly _configuredFrequency: number;
  private readonly _url: string;
  private _repository: InternalFeatureRepository;
  private _pollingService: PollingService | undefined;
  private readonly _options: RestOptions;
  private _startable: boolean;
  private readonly _config: FeatureHubConfig;
  private _xHeader: string | undefined;
  private _currentTimer: ReturnType<typeof setTimeout> | undefined;
  private _whenPollingCacheExpires: number;
  private _closed = false;

  public static pollingClientProvider: PollingClientProvider;

  constructor(
    repository: InternalFeatureRepository,
    config: FeatureHubConfig,
    frequency: number,
    options: RestOptions = {},
  ) {
    this._startable = true;
    this._frequency = frequency;
    this._configuredFrequency = frequency;
    this._repository = repository;
    this._options = options;
    if (this._options.active === undefined) {
      this._options.active = true;
    }
    this._options.extraHeaders = () => configExtraHeaders(config);
    this._config = config;
    // a host's own query string comes first, then apiKey for each key in order
    // (featurehub-protocol.yaml featurehub_edge.query_parameters)
    this._url =
      config.getHost() +
      "features?" +
      [
        configHostQuery(config),
        ...config.getApiKeys().map((e) => "apiKey=" + encodeURIComponent(e)),
      ]
        .filter((p) => p.length > 0)
        .join("&");

    this._whenPollingCacheExpires = Date.now() - 100;
  }

  private _initService(): void {
    if (this._pollingService === undefined && this._startable) {
      this._pollingService = FeatureHubPollingClient.pollingClientProvider(
        this._options,
        this._url,
        this._frequency,
        (e, source) => this.response(e, source),
      );

      fhLog.trace(`featurehub: initialized polling client to ${this._url}`);
    }
  }

  public async contextChange(header: string): Promise<void> {
    if (!this._config.clientEvaluated()) {
      if (this._xHeader !== header) {
        this._xHeader = header;

        if (this._closed) {
          return this.fetchOnceWhileClosed(header);
        }

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

  /**
   * featurehub-protocol.yaml polling_transport.context_changed: a context change on a closed transport makes
   * that one request, so the new context's features arrive, and stays closed. Once the connection has failed
   * or the environment is stale nothing can be fetched, so it makes no request at all.
   */
  private async fetchOnceWhileClosed(header: string): Promise<void> {
    if (
      !this._startable ||
      this._repository.connectionFailed === true ||
      this._repository.environmentStale === true
    ) {
      return;
    }

    const service = FeatureHubPollingClient.pollingClientProvider(
      this._options,
      this._url,
      0,
      (e, source) => this.response(e, source),
    );

    try {
      await service.attributeHeader(header);
      await service.poll();

      if (service.environmentStale === true) {
        this._repository.markEnvironmentStale();
      }
    } catch (failure) {
      const status = pollingFailureStatus(failure);
      if (status !== undefined && status >= 400 && status < 500) {
        fhLog.error(`FeatureHub rejected the request (${status}).`);
        this._startable = false;
        this._repository.notify(SSEResultState.Failure, null, "polling-service");
      }
    } finally {
      service.stop();
    }
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
    this._closed = true;
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
    if (this._closed) {
      resolve?.();
      return;
    }

    // only be true for active polling
    this._cancelTimer();

    // we will only call readyNextPoll if this was the FIRST poll being requested, the polling service
    // can stack up callers and call them all back and we don't want readyNextPoll being triggered multiple times
    const pollingBusy = this._pollingService?.busy || false;

    this._pollingService!.poll()
      .then(() => {
        fhLog.trace("poll successful");

        if (this._pollingService?.environmentStale === true) {
          // the features of the 236 have been applied: nothing more will arrive
          this._repository.markEnvironmentStale();
        }

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
      .catch((failure) => {
        fhLog.trace("poll failed", failure);
        const status = pollingFailureStatus(failure);
        // every 4xx (429 included) means the key or environment is rejected: it will never succeed
        if (status !== undefined && status >= 400 && status < 500) {
          fhLog.error(`FeatureHub rejected the request (${status}), stopping polling.`);

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
            this._readyNextPoll(resolve, reject, failure);
          }

          if (status == 503) {
            fhLog.log("The backend is not ready, waiting for the next poll.");
          }
        }
      });
  }

  /**
   * Schedules the next poll. After a failed poll the caller waiting on it (resolve/reject) is handed to the
   * next poll; if there is none (an interval of 0, passive polling, or no more polls), the caller is told it
   * failed, rather than waiting for ever.
   */
  private _readyNextPoll(
    resolve?: (value: void | PromiseLike<void>) => void,
    reject?: (reason?: unknown) => void,
    failure?: unknown,
  ) {
    if (this._closed) {
      reject?.(failure);
      return;
    }

    const frequency =
      this._configuredFrequency === 0 ? 0 : this._pollingService?.frequency || this._frequency;

    if (this._pollingService?.stopped === true) {
      // FeatureHub has told us the environment will not change again (a 236)
      fhLog.trace("polling service has stopped, no further polls");
    } else if (frequency > 0 && this._options.active) {
      // in case we got a 404, and it was shut down
      fhLog.trace("starting timer for poll", frequency);
      this._currentTimer = setTimeout(() => this._pollFunc(resolve, reject), frequency);
    } else if (this._options.active) {
      fhLog.trace(
        `no polling service or 0 frequency, stopping polling. defined? ${this._pollingService} frequency: ${frequency}`,
      );
    } else {
      // passive polling: with an interval of 0 we polled once, and the cache never expires
      this._whenPollingCacheExpires =
        frequency === 0 ? Number.POSITIVE_INFINITY : Date.now() + frequency;
      fhLog.trace(`passive polling means cache will expire in ${frequency}ms`);
    }

    if (this._currentTimer === undefined) {
      reject?.(failure);
    }

    this._frequency = frequency;
  }

  private response(environments: Array<FeatureEnvironmentCollection>, _source?: string): void {
    // the features of every environment together are one full set (an empty list of environments is a
    // set with no features in it)
    const features = new Array<FeatureState>();

    environments.forEach((e) => {
      (e.features ?? []).forEach((f) => {
        // set the environment id so each feature knows which environment it comes from
        f.environmentId = e.id;
        features.push(f);
      });
    });

    this._repository.notify(SSEResultState.Features, features, "polling-service");
  }
}

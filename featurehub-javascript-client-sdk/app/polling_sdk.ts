// prevents circular deps
import { FeatureEnvironmentCollection, FeatureState, SSEResultState } from './models';
import { EdgeService } from './edge_service';
import { FeatureHubConfig, fhLog } from './feature_hub_config';
import { InternalFeatureRepository } from './internal_feature_repository';
import { sha256 } from 'cross-sha256';
import * as base64 from '@juanelas/base64';

export interface PollingService {

  get frequency(): number;

  poll(): Promise<void>;

  stop(): void;

  attributeHeader(header: string): Promise<void>;
}

export type FeaturesFunction = (environments: Array<FeatureEnvironmentCollection>) => void;

export abstract class PollingBase implements PollingService {
  protected url: string;
  protected _frequency: number;
  protected _callback: FeaturesFunction;
  protected _stopped = false;
  protected _header?: string;
  protected _shaHeader: string;
  protected _etag: string | undefined | null;

  protected constructor(url: string, frequency: number, callback: FeaturesFunction) {
    this.url = url;
    this._frequency = frequency;
    this._shaHeader = '0';
    this._callback = callback;
  }

  attributeHeader(header: string): Promise<void> {
    this._header = header;
    this._shaHeader = (header === undefined || header.length === 0) ? '0' :
      base64.encode(new sha256().update(header).digest(), true, false);
    return this.poll();
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
      const newFreq = parseInt(maxAge[1], 10);
      if (newFreq > 0) {
        this._frequency = newFreq * 1000;
      }
    }
  }

  // this is a dead  function but if we don't include it
  // then node will fail
  // eslint-disable-next-line require-await
  protected async delayTimer(): Promise<void> {
    return new Promise(((resolve) => {
      resolve();
    }));
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
  private readonly _options: BrowserOptions;
  private localStorageLastUrl: string | undefined;

  // override this with a replacement if you need to, for example to add any headers.
  static httpRequestor = () => {
    return new XMLHttpRequest();
  };

  // override this in React Native - for example use AsyncStorage
  static localStorageRequestor = () => {
    if (window.localStorage) {
      return localStorage;
    }

    // maybe in React Native or other similar browsery thing.
    return {
      getItem: () => null,
      setItem: () => {}
    };
  };

  constructor(options: BrowserOptions, url: string, frequency: number, callback: FeaturesFunction) {
    super(url, frequency, callback);

    this._options = options;
  }

  private loadLocalState(url: string) {
    if (url !== this.localStorageLastUrl) {
      this.localStorageLastUrl = url;

      const storedData = BrowserPollingService.localStorageRequestor().getItem(url);
      if (storedData) {
        try {
          const data = JSON.parse(storedData);
          if (data.e) { // save space with short name
            this._callback(data.e as Array<FeatureEnvironmentCollection>);
          }
        } catch (ignored) {
          // ignore exception
        }
      }
    }
  }

  public poll(): Promise<void> {
    if (this._stopped) {
      return new Promise((resolve) => {
        resolve();
      });
    }
    return new Promise((resolve, reject) => {
      const calculatedUrl = `${this.url}&contextSha=${this._shaHeader}`;

      // check in case we have a cached copy of it
      this.loadLocalState(this.url);

      const req = BrowserPollingService.httpRequestor();
      req.open('GET', calculatedUrl);
      req.setRequestHeader('Content-type', 'application/json');

      if (this._etag) {
        req.setRequestHeader('if-none-match', this._etag);
      }

      if (this._header) {
        req.setRequestHeader('x-featurehub', this._header);
      }

      req.send();

      req.onreadystatechange = () => {
        if (req.readyState === 4) {
          if (req.status === 200 || req.status == 236) {
            this._etag = req.getResponseHeader('etag');
            this.parseCacheControl(req.getResponseHeader('cache-control'));

            const environments = JSON.parse(req.responseText) as Array<FeatureEnvironmentCollection>;
            try {
              BrowserPollingService.localStorageRequestor().setItem(this.url, JSON.stringify({ e: environments }));
            } catch (e) {
              fhLog.error('featurehub: unable to cache features');
            }
            this._callback(environments);

            this._stopped = (req.status === 236);
            resolve();
          } else if (req.status == 304) { // no change
            resolve();
          } else {
            reject(req.status);
          }
        }
      };
    });
  }
}

export type PollingClientProvider = (options: BrowserOptions, url: string,
                                     frequency: number, callback: FeaturesFunction) => PollingBase;

export class FeatureHubPollingClient implements EdgeService {
  private readonly _frequency: number;
  private readonly _url: string;
  private _repository: InternalFeatureRepository;
  private _pollingService: PollingService | undefined;
  private readonly _options: BrowserOptions | NodejsOptions;
  private _startable: boolean;
  private readonly _config: FeatureHubConfig;
  private _xHeader: string | undefined;
  private _pollPromiseResolve: ((value: (PromiseLike<void> | void)) => void) | undefined;
  private _pollPromiseReject: ((reason?: any) => void) | undefined;
  private _pollingStarted = false;
  private _currentTimer: any;

  public static pollingClientProvider: PollingClientProvider = (opt, url, freq, callback) =>
    new BrowserPollingService(opt, url, freq, callback);

  constructor(repository: InternalFeatureRepository,
    config: FeatureHubConfig,
    frequency: number,
    options: BrowserOptions | NodejsOptions = {}) {
    this._startable = true;
    this._frequency = frequency;
    this._repository = repository;
    this._options = options;
    this._config = config;
    this._url = config.getHost() + 'features?' + config.getApiKeys().map(e => 'apiKey=' + encodeURIComponent(e)).join('&');
  }

  private _initService(): void {
    if (this._pollingService === undefined && this._startable) {
      this._pollingService =
        FeatureHubPollingClient.pollingClientProvider(this._options, this._url,
          this._frequency,
          (e) =>
            this.response(e));

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
    fhLog.trace('polling stopping');
    // stop the timeout if one is going on
    if (this._currentTimer) {
      clearTimeout(this._currentTimer);
      this._currentTimer = undefined;
    }

    if (this._pollPromiseReject !== undefined) {
      this._pollPromiseReject('Never came live');
    }

    // stop the polling service and clear it
    this._pollingService?.stop();
    this._pollingService = undefined;
  }

  public poll(): Promise<void> {
    if (this._pollPromiseResolve !== undefined || this._pollingStarted) {
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

  public get pollingFrequency() : undefined|number {
    return this._pollingService?.frequency;
  }

  public get active() : boolean {
    return this._pollingStarted || this._currentTimer !== undefined;
  }

  public get awaitingFirstSuccess(): boolean {
    return this._pollPromiseReject !== undefined;
  }

  private _restartTimer() {
    if (this._pollingService === undefined || this._pollingStarted || !this._startable) {
      return;
    }

    fhLog.trace('polling restarting');

    if (this._currentTimer) {
      clearTimeout(this._currentTimer);
      this._currentTimer = undefined;
    }

    this._pollingStarted = true;

    this._pollFunc();
  }

  private _pollFunc() {
    this._pollingService!.poll()
      .then(() => {
        fhLog.trace('poll successful');

        // set the next one going before we resolve as otherwise the test will fail
        this._readyNextPoll();

        if (this._pollPromiseResolve !== undefined) {
          try {
            this._pollPromiseResolve();
          } catch (e) {
            fhLog.error('Failed to process resolve', e);
          }
        }

        this._pollPromiseReject = undefined;
        this._pollPromiseResolve = undefined;
      })
      .catch((status) => {
        fhLog.trace('poll failed', status);
        // ready to poll again at the right interval
        this._pollingStarted = false;

        if (status === 404 || status == 400) {
          if (status == 404) {
            fhLog.error('The API Key provided does not exist, stopping polling.');
          }

          this._repository.notify(SSEResultState.Failure, null);
          this._startable = false;

          this.stop();

          if (this._pollPromiseReject) {
            try {
              this._pollPromiseReject(status);
            } catch (e) {
              fhLog.error('Failed to process reject', e);
            }
          }

          this._pollPromiseReject = undefined;
          this._pollPromiseResolve = undefined;
        } else {
          this._readyNextPoll();

          if (status == 503) {
            fhLog.log('The backend is not ready, waiting for the next poll.');
          }
        }
      }).finally(() => {
      });
  }

  private _readyNextPoll() {
    // ready to poll again at the right interval (tests need this here)
    this._pollingStarted = false;

    if (this._pollingService && this._pollingService.frequency > 0) { // in case we got a 404, and it was shut down
      fhLog.trace('starting timer for poll', this._pollingService.frequency);
      this._currentTimer = setTimeout(() => this._restartTimer(),  this._pollingService.frequency);
    } else {
      fhLog.trace('no polling service or 0 frequence, stopping polling.',
        this._pollingService === undefined,
        this._pollingService?.frequency);
    }
  }

  private response(environments: Array<FeatureEnvironmentCollection>): void {
    if (environments.length === 0) {
      this._startable = false;
      this.stop();
      this._repository.notify(SSEResultState.Failure, null);
    } else {
      const features = new Array<FeatureState>();

      environments.forEach(e => {
        if (e.features!.length > 0) {
          // set the environment id so each feature knows which environment it comes from
          e.features!.forEach(f => {
            f.environmentId = e.id;
          });
          features.push(...e.features!);
        }
      });

      this._repository.notify(SSEResultState.Features, features);
    }
  }

}

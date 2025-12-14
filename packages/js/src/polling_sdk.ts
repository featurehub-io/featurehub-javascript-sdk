import type {
  FeatureEnvironmentCollection,
  FeaturesFunction,
  PollingOptions,
  PollingService,
  PromiseLikeData,
} from "featurehub-javascript-core-sdk";
import { fhLog, PollingBase } from "featurehub-javascript-core-sdk";

import { createBase64UrlSafeHash } from "./crypto-browser";

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
    _options: PollingOptions,
    url: string,
    frequency: number,
    callback: FeaturesFunction,
  ) {
    super(url, frequency, createBase64UrlSafeHash, callback);
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
      ...(this._etag ? ({ "if-none-match": this._etag } as Record<string, string>) : {}),
      ...(this._header ? ({ "x-featurehub": this._header } as Record<string, string>) : {}),
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

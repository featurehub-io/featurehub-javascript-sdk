import type {
  FeatureEnvironmentCollection,
  FeaturesFunction,
  FetchRequestOptions,
  PollingService,
  RestOptions,
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

  constructor(options: RestOptions, url: string, frequency: number, callback: FeaturesFunction) {
    super(url, frequency, createBase64UrlSafeHash, options, callback);
  }

  public override async preload(_req: FetchRequestOptions, url: string): Promise<boolean> {
    if (url !== this.localStorageLastUrl) {
      this.localStorageLastUrl = url;

      const storedData = BrowserPollingService.localStorageRequestor().getItem(url);
      if (storedData) {
        try {
          const data = JSON.parse(storedData);
          if (data.e) {
            // save space with short name
            this._callback(data.e as Array<FeatureEnvironmentCollection>, 'browser-store');
          }
        } catch (_) {
          // ignore exception
        }
      }
    }

    return false;
  }

  public override async postdecode(environments: FeatureEnvironmentCollection[]): Promise<boolean> {
    try {
      if (this.localStorageLastUrl) {
        BrowserPollingService.localStorageRequestor().setItem(
          this.localStorageLastUrl,
          JSON.stringify({ e: environments }),
        );
      }
    } catch (_) {
      fhLog.error("featurehub: unable to cache features");
    }

    return false;
  }
}

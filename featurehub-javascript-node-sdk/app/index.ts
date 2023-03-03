import {
  FeatureHubPollingClient,
  FeatureStateUpdate, FeatureUpdatePostManager, FeatureUpdater, GoogleAnalyticsApiClient, GoogleAnalyticsCollector,
  NodejsOptions,
  PollingBase,
  FeatureHubEventSourceClient,
  PollingService, FeaturesFunction, FeatureEnvironmentCollection, EdgeFeatureHubConfig
} from 'featurehub-javascript-client-sdk';
import { URL } from 'url';
import { RequestOptions } from 'https';

const ES = require('eventsource');

export * from 'featurehub-javascript-client-sdk';

FeatureHubEventSourceClient.eventSourceProvider = (url, dict) => {
  return new ES(url, dict);
};

export type ModifyRequestFunction = (options: RequestOptions) => void;

export class NodejsPollingService extends PollingBase implements PollingService {
  private readonly uri: URL;
  private readonly _options: NodejsOptions;
  public modifyRequestFunction: ModifyRequestFunction | undefined;

  constructor(options: NodejsOptions, url: string, frequency: number, _callback: FeaturesFunction) {
    super(url, frequency, _callback);

    this._options = options;
    this.uri = new URL(this.url);
  }

  public poll(): Promise<void> {
    if (this._stopped) {
      return new Promise((resolve) => resolve());
    }

    return new Promise(((resolve, reject) => {
      const http = this.uri.protocol === 'http:' ? require('http') : require('https');
      let data = '';
      const headers = this._header === undefined ? {} : {
        'x-featurehub': this._header
      };

      if (this._etag) {
        headers['if-none-match'] = this._etag;
      }

      // we are not specifying the type as it forces us to bring in one of http or https
      const reqOptions: RequestOptions = {
        protocol: this.uri.protocol,
        host: this.uri.host,
        hostname: this.uri.hostname,
        port: this.uri.port,
        method: 'GET',
        path: this.uri.pathname + this.uri.search + `&contextSha=${this._shaHeader}`,
        headers: headers,
        timeout: this._options.timeout || 8000
      };

      if (this.modifyRequestFunction) {
        this.modifyRequestFunction(reqOptions);
      }

      const req = http.request(reqOptions, (res) => {
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => {
          this.parseCacheControl(res.headers['cache-control']);
          if (res.statusCode === 200 || res.statusCode === 236) {
            this._etag = res.headers.etag;
            this._callback(JSON.parse(data) as Array<FeatureEnvironmentCollection>);
            this._stopped = (res.statusCode === 236);
            resolve();
          } else if (res.statusCode == 304) {
            resolve();
          } else {
            reject(res.statusCode);
          }
        });
      });

      req.end();
    }));
  }

}

FeatureHubPollingClient.pollingClientProvider = (opt, url, freq, callback) =>
  new NodejsPollingService(opt, url, freq, callback);

class NodejsFeaturePostUpdater implements FeatureUpdatePostManager {
  post(url: string, update: FeatureStateUpdate): Promise<boolean> {
    const loc = new URL(url);
    const cra = { protocol: loc.protocol, path: loc.pathname,
      host: loc.hostname, method: 'PUT', port: loc.port, timeout: 3000,
      headers: {
        'content-type': 'application/json'
      }
    };
    const http = cra.protocol === 'http:' ? require('http') : require('https');
    return new Promise<boolean>((resolve) => {
      try {
        const req = http.request(cra, (res) => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(true);
          } else {
            resolve(false);
          }
        });

        req.on('error', () => {
          resolve(false);
        });

        req.write(JSON.stringify(update));
        req.end();
      } catch (e) {
        resolve(false);
      }
    });
  }

}

FeatureUpdater.featureUpdaterProvider = () => new NodejsFeaturePostUpdater();

class NodejsGoogleAnalyticsApiClient implements GoogleAnalyticsApiClient {
  cid(other: Map<string, string>): string {
    return other.get('cid') || process.env.GA_CID;
  }

  postBatchUpdate(batchData: string): void {
    const req = require('https').request({
      host: 'www.google-analytics.com',
      path: 'batch'
    });
    req.write(batchData);
    req.end();
  }
}

GoogleAnalyticsCollector.googleAnalyticsClientProvider = () => new NodejsGoogleAnalyticsApiClient();
EdgeFeatureHubConfig.defaultEdgeServiceSupplier = (repository, config) => new FeatureHubEventSourceClient(config, repository);

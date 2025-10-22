/* eslint-disable @typescript-eslint/no-require-imports */
import {
  EdgeFeatureHubConfig,
  type FeatureEnvironmentCollection,
  FeatureHubEventSourceClient,
  FeatureHubPollingClient,
  type FeaturesFunction,
  type FeatureStateUpdate,
  type FeatureUpdatePostManager,
  FeatureUpdater,
  FHLog,
  fhLog,
  type GoogleAnalyticsApiClient,
  GoogleAnalyticsCollector,
  type NodejsOptions,
  PollingBase,
  type PollingService,
  type PromiseLikeFunction,
  type RejectLikeFunction,
} from "featurehub-javascript-client-sdk";
import type { RequestOptions } from "https";
import { URL } from "url";

const ES = require("eventsource");

export * from "featurehub-javascript-client-sdk";

FeatureHubEventSourceClient.eventSourceProvider = (url, dict) => {
  return new ES(url, dict);
};

interface PromiseLikeData {
  resolve: PromiseLikeFunction;
  reject: RejectLikeFunction;
}

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
    if (this._busy) {
      return new Promise((resolve, reject) => {
        this._outstandingPromises.push({ resolve: resolve, reject: reject } as PromiseLikeData);
      });
    }

    if (this._stopped) {
      return new Promise((resolve) => resolve());
    }

    this._busy = true;

    return new Promise((resolve, reject) => {
      const http = this.uri.protocol === "http:" ? require("http") : require("https");
      let data = "";
      const headers: Record<string, string> =
        this._header === undefined
          ? {}
          : {
              "x-featurehub": this._header,
            };

      if (this._etag) {
        headers["if-none-match"] = this._etag;
      }

      // we are not specifying the type as it forces us to bring in one of http or https
      const reqOptions: RequestOptions = {
        protocol: this.uri.protocol,
        host: this.uri.host,
        hostname: this.uri.hostname,
        port: this.uri.port,
        method: "GET",
        path: this.uri.pathname + this.uri.search + `&contextSha=${this._shaHeader}`,
        headers: headers,
        timeout: this._options.timeout || 8000,
      };

      if (this.modifyRequestFunction) {
        this.modifyRequestFunction(reqOptions);
      }

      const req = http.request(reqOptions, (res: any) => {
        res.on("data", (chunk: any) => (data += chunk));
        res.on("end", () => {
          this.parseCacheControl(res.headers["cache-control"]);
          if (res.statusCode === 200 || res.statusCode === 236) {
            this._etag = res.headers.etag;
            this._callback(JSON.parse(data) as Array<FeatureEnvironmentCollection>);
            this._stopped = res.statusCode === 236;
            this._busy = false;
            this.resolveOutstanding();
            resolve();
          } else if (res.statusCode == 304) {
            this._busy = false;
            this.resolveOutstanding();
            resolve();
          } else {
            this._busy = false;
            this.rejectOutstanding(req.status);
            reject(res.statusCode);
          }
        });
      });

      req.end();
    });
  }
}

FeatureHubPollingClient.pollingClientProvider = (opt, url, freq, callback) =>
  new NodejsPollingService(opt, url, freq, callback);

export class NodejsFeaturePostUpdater implements FeatureUpdatePostManager {
  public modifyRequestFunction: ModifyRequestFunction | undefined;

  post(url: string, update: FeatureStateUpdate): Promise<boolean> {
    const loc = new URL(url);

    const cra: RequestOptions = {
      protocol: loc.protocol,
      path: loc.pathname,
      host: loc.hostname,
      method: "PUT",
      port: loc.port,
      timeout: 3000,
      headers: {
        "content-type": "application/json",
      },
    };

    // allows you to override it with any security or such
    if (this.modifyRequestFunction) {
      this.modifyRequestFunction(cra);
    }

    const http = cra.protocol === "http:" ? require("http") : require("https");
    return new Promise<boolean>((resolve) => {
      try {
        const req = http.request(cra, (res: any) => {
          fhLog.trace("update result -> ", res.statusCode);
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(true);
          } else {
            resolve(false);
          }
        });

        req.on("error", () => {
          fhLog.trace("update result -> error");
          resolve(false);
        });

        FHLog.fhLog.trace("FeatureUpdater", cra, update);
        req.write(JSON.stringify(update));
        req.end();
      } catch (_e) {
        resolve(false);
      }
    });
  }
}

FeatureUpdater.featureUpdaterProvider = () => new NodejsFeaturePostUpdater();

class NodejsGoogleAnalyticsApiClient implements GoogleAnalyticsApiClient {
  cid(other: Map<string, string>): string {
    return other.get("cid") || process.env["GA_CID"] || "";
  }

  postBatchUpdate(batchData: string): void {
    const req = require("https").request({
      host: "www.google-analytics.com",
      path: "batch",
    });
    req.write(batchData);
    req.end();
  }
}

GoogleAnalyticsCollector.googleAnalyticsClientProvider = () => new NodejsGoogleAnalyticsApiClient();
EdgeFeatureHubConfig.defaultEdgeServiceSupplier = (repository, config) =>
  new FeatureHubEventSourceClient(config, repository);

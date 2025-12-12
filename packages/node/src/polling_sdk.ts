import type {
  FeatureEnvironmentCollection,
  FeaturesFunction, FeatureStateUpdate, FeatureUpdatePostManager,
  PollingOptions,
  PollingService,
  PromiseLikeFunction,
  RejectLikeFunction
} from "featurehub-javascript-core-sdk";
import {FeatureHubPollingClient, fhLog, FHLog, PollingBase} from "featurehub-javascript-core-sdk";
import {URL} from "url";
import {createBase64UrlSafeHash} from "./crypto-node";

interface PromiseLikeData {
  resolve: PromiseLikeFunction;
  reject: RejectLikeFunction;
}

type FetchRequestOptions = RequestInit & {
  protocol: string;
  host: string;
  hostname: string;
  port: string;
  path: string;
  method: string;
  search: string;
  headers: Record<string, string>;
  timeout: number;
};

export type ModifyRequestFunction = (options: FetchRequestOptions) => void;

export class NodejsPollingService extends PollingBase implements PollingService {
  private readonly uri: URL;
  private readonly _options: PollingOptions;
  public modifyRequestFunction: ModifyRequestFunction | undefined;

  constructor(options: PollingOptions, url: string, frequency: number, _callback: FeaturesFunction) {
    super(url, frequency, createBase64UrlSafeHash, _callback);

    this._options = options;
    this.uri = new URL(this.url);
  }

  public async poll(): Promise<unknown> {
    if (this._busy) {
      return new Promise((resolve, reject) => {
        this._outstandingPromises.push({ resolve: resolve, reject: reject } as PromiseLikeData);
      });
    }

    if (this._stopped) {
      return new Promise((resolve) => resolve());
    }

    this._busy = true;

    const headers: Record<string, string> = this._header ? { "x-featurehub": this._header } as Record<string, string> : {};

    if (this._etag) headers["if-none-match"] = this._etag;

    // we are not specifying the type as it forces us to bring in one of http or https
    const req: FetchRequestOptions = {
      method: "GET",
      headers,
      protocol: this.uri.protocol,
      host: this.uri.host,
      hostname: this.uri.hostname,
      port: this.uri.port,
      path: this.uri.pathname,
      search: `${this.uri.search}&contextSha=${this._shaHeader}`,
      timeout: this._options.timeout || 8000,
    };

    this.modifyRequestFunction?.(req);

    const url = `${req.protocol}//${req.host}${req.path}${req.search}`;

    // Create AbortController for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this._options.timeout || 8000);

    const response = await fetch(url, {
      headers,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    this.parseCacheControl(response.headers.get("cache-control"));

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

    const environments = JSON.parse(await response.text()) as FeatureEnvironmentCollection[];

    this._callback(environments);
    this._stopped = response.status === 236;
    this._busy = false;
    this.resolveOutstanding();
  }
}


export class NodejsFeaturePostUpdater implements FeatureUpdatePostManager {
  public modifyRequestFunction: ModifyRequestFunction | undefined;

  async post(url: string, update: FeatureStateUpdate): Promise<boolean> {
    const loc = new URL(url);
    const headers: Record<string, string> = {
      "content-type": "application/json",
    };

    const req: FetchRequestOptions = {
      method: "PUT",
      headers,
      protocol: loc.protocol,
      host: loc.host,
      hostname: loc.hostname,
      port: loc.port,
      path: loc.pathname,
      search: loc.search,
      timeout: 3000,
    };

    this.modifyRequestFunction?.(req);

    // Extract any modified headers back
    Object.assign(headers, req.headers);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);

    FHLog.fhLog.trace("FeatureUpdater", req, update);

    try {
      const _url = `${req.protocol}//${req.host}${req.path}${req.search}`;

      const response = await fetch(_url, {
        method: req.method,
        headers: req.headers,
        body: JSON.stringify(update),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        fhLog.trace("update result -> error");
        return false;
      }

      fhLog.trace("update result -> ", response.status);
      return response.ok;
    } catch (_e) {
      fhLog.trace("update result -> error");
      return false;
    }
  }
}

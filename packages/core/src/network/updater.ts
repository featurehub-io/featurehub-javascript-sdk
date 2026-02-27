import { URL } from "url";

import { fhLog } from "../feature_hub_config";
import type { FeatureStateUpdate } from "../models";
import type { FetchRequestOptions } from "./common";
import type { RestOptions } from "./polling_sdk";
import type { FeatureUpdatePostManager } from "./test_sdk";

export class FeaturePostUpdater implements FeatureUpdatePostManager {
  async post(url: string, update: FeatureStateUpdate, opt?: RestOptions): Promise<boolean> {
    const options = opt || {};
    const loc = new URL(url);
    const headers: Record<string, string> = {
      "content-type": "application/json",
    };

    const req: FetchRequestOptions = {
      method: "PUT",
      headers: headers,
      protocol: loc.protocol,
      host: loc.host,
      hostname: loc.hostname,
      port: loc.port,
      path: loc.pathname,
      search: loc.search,
      timeout: options.timeout || 3000,
    };

    options.modifyRequestFunction?.(req);

    // Extract any modified headers back
    Object.assign(headers, req.headers);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), req.timeout || 3000);

    fhLog.trace("FeatureUpdater", req, update);

    try {
      const _url = `${req.protocol}//${req.host}${req.path}${req.search}`;

      const response = await fetch(_url, {
        method: req.method,
        headers: req.headers,
        body: JSON.stringify(update),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (response.status < 200 || response.status >= 300) {
        fhLog.trace(`update result -> error ${response.status}: ${response.statusText}`);
        return false;
      }

      fhLog.trace(`update result -> ${response.status}`);
      return response.ok;
    } catch (e) {
      fhLog.trace(`update result -> error ${e}`);
      return false;
    }
  }
}

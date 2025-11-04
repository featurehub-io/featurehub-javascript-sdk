import type { FeatureHubConfig } from "./feature_hub_config";
import type { FeatureStateUpdate } from "./models";

export interface FeatureUpdatePostManager {
  post(url: string, update: FeatureStateUpdate): Promise<boolean>;
}

class BrowserFeaturePostUpdater implements FeatureUpdatePostManager {
  post(url: string, update: FeatureStateUpdate): Promise<boolean> {
    return fetch(url, {
      method: "PUT",
      headers: {
        "Content-type": "application/json",
      },
      body: JSON.stringify(update),
    })
      .then((res) => res.status >= 200 && res.status < 300)
      .catch(() => false);
  }
}

export type FeatureUpdaterProvider = () => FeatureUpdatePostManager;

export class FeatureUpdater {
  private sdkUrl: string;
  public readonly manager: FeatureUpdatePostManager;

  public static featureUpdaterProvider: FeatureUpdaterProvider = () =>
    new BrowserFeaturePostUpdater();

  constructor(config: FeatureHubConfig) {
    this.sdkUrl = config.url();

    this.manager = FeatureUpdater.featureUpdaterProvider();
  }

  public updateKey(key: string, update: FeatureStateUpdate): Promise<boolean> {
    return this.manager.post(this.sdkUrl + "/" + key, update);
  }
}

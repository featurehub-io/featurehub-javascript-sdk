import type { FeatureHubConfig } from "../feature_hub_config";
import type { FeatureStateUpdate } from "../models";
import type { RestOptions } from "./polling_sdk";
import { FeaturePostUpdater } from "./updater";

export interface FeatureUpdatePostManager {
  post(url: string, update: FeatureStateUpdate, options?: RestOptions): Promise<boolean>;
}

export type FeatureUpdaterProvider = () => FeatureUpdatePostManager;

export class FeatureUpdater {
  private sdkUrl: string;
  public readonly manager: FeatureUpdatePostManager;

  private _defaultOptions: RestOptions = {};

  public static featureUpdaterProvider: FeatureUpdaterProvider = () => new FeaturePostUpdater();

  constructor(config: FeatureHubConfig) {
    this.sdkUrl = config.url();

    this.manager = FeatureUpdater.featureUpdaterProvider();
  }

  public updateKey(
    key: string,
    update: FeatureStateUpdate,
    options?: RestOptions,
  ): Promise<boolean> {
    const opt = Object.assign(this._defaultOptions, options || {});
    return this.manager.post(this.sdkUrl + "/" + key, update, opt);
  }

  public set defaultOptions(opt: RestOptions) {
    this._defaultOptions = opt;
  }
}

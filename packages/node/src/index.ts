import { EventSource } from "eventsource";
import {
  ClientContext,
  EdgeFeatureHubConfig,
  FeatureHubConfig,
  FeatureHubEventSourceClient,
  FeatureHubPollingClient,
  FeatureStateHolder,
  FeatureUpdater,
} from "featurehub-javascript-core-sdk";

import { NodejsFeaturePostUpdater, NodejsPollingService } from "./polling_sdk";

export * from "./polling_sdk";
export * from "featurehub-javascript-core-sdk";

FeatureHubEventSourceClient.eventSourceProvider = (url, dict) => {
  return new EventSource(url, dict);
};

export class FeatureHub {
  public static feature<T = any>(key: string): FeatureStateHolder<T> | undefined {
    return this.context?.feature(key);
  }

  private static cfg: { fhConfig?: FeatureHubConfig; fhContext?: ClientContext } = {};

  public static set(config?: FeatureHubConfig, context?: ClientContext) {
    FeatureHub.cfg.fhConfig = config;
    FeatureHub.cfg.fhContext = context;
  }

  public static get context(): ClientContext | undefined {
    return FeatureHub.cfg.fhContext;
  }

  public static get config(): FeatureHubConfig | undefined {
    return FeatureHub.cfg.fhConfig;
  }

  static close() {
    if (FeatureHub.config) {
      FeatureHub.config.close();

      FeatureHub.set(undefined, undefined);
    }
  }
}

FeatureUpdater.featureUpdaterProvider = () => new NodejsFeaturePostUpdater();

FeatureHubPollingClient.pollingClientProvider = (opt, url, freq, callback) =>
  new NodejsPollingService(opt, url, freq, callback);

EdgeFeatureHubConfig.defaultEdgeServiceSupplier = (repository, config) =>
  new FeatureHubEventSourceClient(config, repository);

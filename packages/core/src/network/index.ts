import { EdgeType } from "../feature_hub_config";
import type { EdgeServiceProvider } from "../featurehub_repository";
import { FeatureHubEventSourceClient } from "./featurehub_eventsource";
import { FeatureHubPollingClient } from "./polling_sdk";

export * from "./common";
export * from "./featurehub_eventsource";
export * from "./polling_sdk";
export * from "./test_sdk";
export * from "./updater";

// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class FeatureHubNetwork {
  static defaultEdgeServiceSupplier: EdgeServiceProvider = (
    repository,
    config,
    edgeType,
    timeout,
  ) => {
    if (edgeType === EdgeType.REST_PASSIVE) {
      return new FeatureHubPollingClient(repository, config, timeout, { active: false });
    } else if (edgeType === EdgeType.REST_ACTIVE) {
      return new FeatureHubPollingClient(repository, config, timeout, { active: true });
    } else {
      return new FeatureHubEventSourceClient(config, repository);
    }
  };
}

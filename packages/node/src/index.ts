import { EventSource } from "eventsource";
import {
  ClientContext,
  defaultEdgeTypeProviderConfig,
  EdgeType,
  FeatureHubConfig,
  FeatureHubEventSourceClient,
  FeatureHubPollingClient,
  FeatureStateHolder,
} from "featurehub-javascript-core-sdk";

import { NodejsPollingService } from "./polling_sdk";

export * from "./polling_sdk";
export * from "featurehub-javascript-core-sdk";

// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class FeatureHub {
  public static feature(key: string): FeatureStateHolder | undefined {
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

// tell it what kind of client to create by default
defaultEdgeTypeProviderConfig.defaultEdgeProvider = process.env["FEATUREHUB_POLLING_INTERVAL"]
  ? process.env["FEATUREHUB_POLLING_PASSIVE"]
    ? EdgeType.REST_PASSIVE
    : EdgeType.REST_ACTIVE
  : EdgeType.STREAMING;
defaultEdgeTypeProviderConfig.defaultTimeoutInMilliseconds = parseInt(
  process.env["FEATUREHUB_POLLING_INTERVAL"] || "0",
);
// streaming doesn't use a timeout

// we need to know how to construct a NodeJS EventSource
FeatureHubEventSourceClient.eventSourceProvider = (url, dict) => {
  return new EventSource(url, dict);
};

// when a Polling Service is actually created, we need to pass the hash generator for node
FeatureHubPollingClient.pollingClientProvider = (opt, url, freq, callback) =>
  new NodejsPollingService(opt, url, freq, callback);

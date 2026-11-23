import { EventSource } from "eventsource";
import {
  ClientContext,
  connectionFromEnvironment,
  defaultEdgeTypeProviderConfig,
  EdgeType,
  FeatureHubConfig,
  FeatureHubEventSourceClient,
  FeatureHubPollingClient,
  FeatureStateHolder,
  fhLog,
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

// tell it what kind of client to create by default: FEATUREHUB_CONNECT_TYPE and FEATUREHUB_CONNECT_INTERVAL
// (featurehub-protocol.yaml providers.environment_variables), or, when neither is set, the legacy variables
// read as they always have been (FEATUREHUB_POLLING_INTERVAL in milliseconds, FEATUREHUB_POLLING_PASSIVE)
const fromEnvironment = connectionFromEnvironment(process.env);

if (fromEnvironment) {
  fromEnvironment.warnings.forEach((w) => fhLog.warn(`[featurehubsdk] ${w}`));
  defaultEdgeTypeProviderConfig.defaultEdgeProvider = fromEnvironment.edgeType;
  // undefined: polling must then be given an interval in code
  defaultEdgeTypeProviderConfig.defaultTimeoutInMilliseconds = fromEnvironment.intervalMs;
} else {
  if (process.env["FEATUREHUB_POLLING_INTERVAL"] || process.env["FEATUREHUB_POLLING_PASSIVE"]) {
    fhLog.warn(
      "[featurehubsdk] FEATUREHUB_POLLING_INTERVAL and FEATUREHUB_POLLING_PASSIVE are deprecated: use " +
        "FEATUREHUB_CONNECT_TYPE and FEATUREHUB_CONNECT_INTERVAL",
    );
  }

  defaultEdgeTypeProviderConfig.defaultEdgeProvider = process.env["FEATUREHUB_POLLING_INTERVAL"]
    ? process.env["FEATUREHUB_POLLING_PASSIVE"]
      ? EdgeType.REST_PASSIVE
      : EdgeType.REST_ACTIVE
    : EdgeType.STREAMING;
  defaultEdgeTypeProviderConfig.defaultTimeoutInMilliseconds = parseInt(
    process.env["FEATUREHUB_POLLING_INTERVAL"] || "0",
  );
}

// the SDK makes every streaming reconnection itself in Node, so it can back off and send Last-Event-ID
FeatureHubEventSourceClient.sdkManagesReconnection = true;

// we need to know how to construct a NodeJS EventSource. eventsource v3+ ignores a headers option, so the
// headers (x-featurehub, the context of a server-evaluated key) are added by the fetch it uses
FeatureHubEventSourceClient.eventSourceProvider = (url, dict) => {
  const headers = { ...((dict?.headers ?? {}) as Record<string, string>) };

  return new EventSource(url, {
    withCredentials: dict?.withCredentials ?? false,
    fetch: (input, init) =>
      fetch(input, {
        ...init,
        headers: { ...(init?.headers ?? {}), ...headers },
      }),
  }) as unknown as ReturnType<typeof FeatureHubEventSourceClient.eventSourceProvider>;
};

// when a Polling Service is actually created, we need to pass the hash generator for node
FeatureHubPollingClient.pollingClientProvider = (opt, url, freq, callback) =>
  new NodejsPollingService(opt, url, freq, callback);

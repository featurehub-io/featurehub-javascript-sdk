import {
  EdgeFeatureHubConfig,
  type FeatureHubConfig,
  FeatureHubPollingClient,
  featureSnapshotConfig,
  FHLog,
  NodejsPollingService,
  FeatureEnvironmentCollection,
  pollingIntervalFromEnvironment,
} from "featurehub-javascript-node-sdk";
import { SegmentUsagePlugin } from "featurehub-usage-segment";
import { Analytics } from "@segment/analytics-node";
import { OpenTelemetryTrackerUsagePlugin } from "featurehub-usage-opentelemetry";
import { OTEL_ENABLED } from "./instrumentation";

function getApplicationServerUrl(): string {
  let appUrl;

  if (
    process.env["FEATUREHUB_EDGE_URL"] === undefined ||
    process.env["FEATUREHUB_CLIENT_API_KEY"] === undefined
  ) {
    console.error(
      "You must define the Application server URL under test in the environment variable FEATUREHUB_EDGE_URL and the API key in FEATUREHUB_CLIENT_API_KEY",
    );
    process.exit(-1);
  } else {
    appUrl = process.env["APP_SERVER_URL"] || "http://localhost:8099";
  }

  return appUrl;
}

// FEATUREHUB_SNAPSHOT_URL set: the tests read their features from the todo backend's feature snapshot endpoint
// (its /featurehub) instead of FeatureHub, so each change goes FeatureHub -> todo backend -> tests. Changes are
// still made through FeatureHub. Its polling interval is FEATUREHUB_CONNECT_INTERVAL (or
// FEATUREHUB_POLLING_INTERVAL), else 5 seconds
const SNAPSHOT_URL = process.env["FEATUREHUB_SNAPSHOT_URL"];
const SNAPSHOT_INTERVAL_MS = pollingIntervalFromEnvironment(process.env) || 5000;

// the config the tests change features through (FeatureHub's test API): it never connects in snapshot mode
function getUpdateConfig(): EdgeFeatureHubConfig {
  return new EdgeFeatureHubConfig(
    process.env["FEATUREHUB_EDGE_URL"]!,
    process.env["FEATUREHUB_CLIENT_API_KEY"]!,
  );
}

const updateConfig = getUpdateConfig();

function getSnapshotConfig(url: string): FeatureHubConfig {
  console.log(`reading features from the todo backend at ${url}, every ${SNAPSHOT_INTERVAL_MS}ms`);
  const fhConfig = featureSnapshotConfig({
    url,
    intervalMs: SNAPSHOT_INTERVAL_MS,
    headers: () => ({ "cuke-req-id": `cuke-req-id=${Config.reqIdPrefix}-${Config.cukeId}` }),
  });
  fhConfig.init();
  return fhConfig;
}

function getFhConfig(): FeatureHubConfig {
  if (SNAPSHOT_URL) {
    return getSnapshotConfig(SNAPSHOT_URL);
  }

  const fhConfig = updateConfig;
  // if a Segment key is defined, set it up and register it as a usage plugin
  if (process.env["SEGMENT_WRITE_KEY"] && process.env["SEGMENT_ENABLED"]) {
    console.log("configuring Segment plugin");
    const analytics = new Analytics({ writeKey: process.env["SEGMENT_WRITE_KEY"] });
    fhConfig.addUsagePlugin(new SegmentUsagePlugin(() => analytics));
  }

  // forces instrumentation to be loaded first
  if (OTEL_ENABLED) {
    console.log("configuring otel plugin");
    fhConfig.addUsagePlugin(new OpenTelemetryTrackerUsagePlugin());
  }

  FeatureHubPollingClient.pollingClientProvider = (opt, url, freq, callback) => {
    // subsume the callback so we can print out the data received
    const cb = (environments: Array<FeatureEnvironmentCollection>) => {
      console.log(`features received ${JSON.stringify(environments)}`);
      callback(environments);
    };

    opt.modifyRequestFunction = (options) => {
      options.headers["cuke-req-id"] = `cuke-req-id=${Config.reqIdPrefix}-${Config.cukeId}`;
    };

    const pollingInterval = pollingIntervalFromEnvironment(process.env);
    if (pollingInterval) {
      opt.timeout = pollingInterval < 3000 ? 3000 : pollingInterval;
    }
    // we are overriding the provider here so we can modify the request function
    return new NodejsPollingService(opt, url, freq, cb);
  };

  FHLog.fhLog.trace = (...args: any[]) => {
    console.log(new Date().toISOString(), ...args);
  };
  FHLog.fhLog.log = (...args: any[]) => {
    console.log(new Date().toISOString(), ...args);
  };
  FHLog.fhLog.warn = (...args: any[]) => {
    console.log(new Date().toISOString(), ...args);
  };
  FHLog.fhLog.error = (...args: any[]) => {
    console.error(new Date().toISOString(), ...args);
  };

  fhConfig.init();

  return fhConfig;
}

export class Config {
  public static baseApplicationPath = getApplicationServerUrl();
  public static updateConfig = updateConfig;
  /** where the tests read features from: FeatureHub, or the todo backend's snapshot endpoint */
  public static fhConfig = getFhConfig();
  /** how much longer a change takes to reach the tests: in snapshot mode, one more poll */
  public static extraWaitMs = SNAPSHOT_URL ? SNAPSHOT_INTERVAL_MS : 0;
  public static cukeId: number = 1;
  public static reqIdPrefix = process.env["REQUEST_ID_PREFIX"] || "poll";
}

import {
  EdgeFeatureHubConfig,
  FeatureHubPollingClient,
  FHLog,
  NodejsPollingService,
  FeatureEnvironmentCollection,
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

function getFhConfig(): EdgeFeatureHubConfig {
  const fhConfig = new EdgeFeatureHubConfig(
    process.env["FEATUREHUB_EDGE_URL"]!,
    process.env["FEATUREHUB_CLIENT_API_KEY"]!,
  );
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

    if (process.env["FEATUREHUB_POLLING_INTERVAL"]) {
      const timeout = parseInt(process.env["FEATUREHUB_POLLING_INTERVAL"]);
      opt.timeout = timeout < 3000 ? 3000 : timeout;
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
  public static fhConfig = getFhConfig();
  public static cukeId: number = 1;
  public static reqIdPrefix = process.env["REQUEST_ID_PREFIX"] || "poll";
}

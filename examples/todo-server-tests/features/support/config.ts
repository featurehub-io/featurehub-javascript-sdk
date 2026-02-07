import {
  EdgeFeatureHubConfig,
  FeatureHubPollingClient,
  FHLog, NodejsPollingService,
  FeatureEnvironmentCollection
} from "featurehub-javascript-node-sdk";

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

  FeatureHubPollingClient.pollingClientProvider = (opt, url, freq, callback) => {
    // subsume the callback so we can print out the data received
    const cb = (environments: Array<FeatureEnvironmentCollection>) => {
      console.log(`features received ${JSON.stringify(environments)}`)
      callback(environments);
    }

    // we are overriding the provider here so we can modify the request function
    const n = new NodejsPollingService(opt, url, freq, cb);

    n.modifyRequestFunction = (options) => {
      options.headers['cuke-req-id'] = `cuke-req-id=${Config.reqIdPrefix}-${Config.cukeId}`
    }
    return n;
  }


  if (process.env["FEATUREHUB_POLLING_INTERVAL"]) {
    fhConfig.edgeServiceProvider(
      (repo, config) =>
        new FeatureHubPollingClient(
          repo,
          config,
          parseInt(process.env["FEATUREHUB_POLLING_INTERVAL"]!),
        ),
    );
  }

  FHLog.fhLog.trace = (...args: any[]) => {
    console.log(args);
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

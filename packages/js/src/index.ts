import {
  type ClientContext,
  type ContextRecord,
  EdgeFeatureHubConfig,
  type FeatureHubConfig,
  FeatureHubPollingClient,
  type FeatureStateHolder,
  fhLog,
} from "featurehub-javascript-core-sdk";

import { BrowserPollingService } from "./polling_sdk";

export * from "./polling_sdk";
export * from "featurehub-javascript-core-sdk";

FeatureHubPollingClient.pollingClientProvider = (opt, url, freq, callback) =>
  new BrowserPollingService(opt, url, freq, callback);

declare global {
  interface Window {
    fhConfig?: FeatureHubConfig;
    fhContext?: ClientContext;
  }
}

const fhConfigKey = "fhConfig";
const fhContextKey = "fhContext";
const fhUnloadListenerLoaded = "fhUnloadListenerExists";
const expectedValueForUnload = "featurehub-initialized";

// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class FeatureHub {
  public static feature(key: string): FeatureStateHolder {
    return this.context.feature(key);
  }

  public static set(config: FeatureHubConfig, context: ClientContext) {
    window[fhConfigKey] = config;
    window[fhContextKey] = context;
  }

  public static get context(): ClientContext {
    const fhContext = window[fhContextKey];
    if (fhContext) {
      return fhContext;
    }

    throw new Error("No FeatureHub context defined");
  }

  public static get config(): FeatureHubConfig {
    const fhConfig = window[fhConfigKey];
    if (fhConfig) {
      return fhConfig;
    }

    throw new Error("No FeatureHub config defined");
  }

  public static _initialize() {
    // @ts-expect-error of course it is an any
    if (!window[fhUnloadListenerLoaded]) {
      // @ts-expect-error of course it is an any
      window[fhUnloadListenerLoaded] = expectedValueForUnload;

      window.addEventListener("beforeunload", () => {
        const cfg = window[fhConfigKey];
        if (cfg) {
          try {
            fhLog.trace("unloading featurehub config!");
            (cfg as FeatureHubConfig).close();
          } catch (_e) {
            // ignore
          }
        } else {
          fhLog.trace("featurehub not configured");
        }
      });
    }
    // check for a meta tag with the featurehub API key and url
    const metaTags = document.getElementsByTagName("meta");
    const apiKeys: Array<string> = [];
    let pollInterval: string | undefined;
    let url: string | undefined;
    let client: string | undefined;
    const params: ContextRecord = {};

    for (let count = 0; count < metaTags.length; count++) {
      const name = metaTags[count]?.getAttribute("name");
      const content = metaTags[count]?.content;

      if (content) {
        if (name === "featurehub-url") {
          url = content;
        } else if (content && name === "featurehub-apiKey") {
          apiKeys.push(content);
        } else if (name === "featurehub-client") {
          client = content.toLowerCase();
        } else if (name === "featurehub-interval") {
          pollInterval = content;
        } else if (name === "featurehub-loglevel") {
          switch (content) {
            // @ts-expect-error we want fallthrough

            case "trace":
              fhLog.trace = (..._args: unknown[]) => {
                console.log("FeatureHub/Trace: ", ..._args);
              };
            // @ts-expect-error  we want fallthrough
            // eslint-disable-next-line
            case "log":
              fhLog.log = (..._args: unknown[]) => {
                console.log("FeatureHub/Debug: ", ..._args);
              };
            // eslint-disable-next-line
            case "error":
              fhLog.error = (..._args: unknown[]) => {
                console.error("FeatureHub/Debug: ", ..._args);
              };
              break;
            default:
              fhLog.trace = () => {};
              fhLog.log = () => {};
              fhLog.error = () => {};
              break;
          }
        } else if (name?.startsWith("featurehub-")) {
          params[name.substring(11)] = content;
        }
      }
    }

    if (apiKeys.length > 0) {
      const config = EdgeFeatureHubConfig.config(
        url || "https://app.featurehub.io/vanilla",
        apiKeys[0]!,
      );

      if (client === "streaming") {
        config.streaming();
      } else if (pollInterval) {
        if (client === "passive" || client === "passive-rest" || client === "passive-poll") {
          config.restPassive(parseInt(pollInterval));
        } else {
          config.restActive(parseInt(pollInterval));
        }
      }

      if (apiKeys.length > 1) {
        for (let count = 1; count < apiKeys.length; count++) {
          config.apiKey(apiKeys[count]!);
        }
      }

      const context = config.context(params);

      context.build();

      this.set(config, context);
    }
  }

  static close() {
    this.config.close();
  }
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
  FeatureHub._initialize();
}

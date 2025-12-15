import {
  type ClientContext,
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

export class FeatureHub {
  public static feature<T = any>(key: string): FeatureStateHolder<T> {
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
    const params: Array<Array<string>> = [];

    for (let count = 0; count < metaTags.length; count++) {
      const name = metaTags[count]?.getAttribute("name");
      const content = metaTags[count]?.content;

      if (name === "featurehub-url") {
        url = content;
      } else if (content && name === "featurehub-apiKey") {
        apiKeys.push(content);
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
      } else if (content && name?.startsWith("featurehub-")) {
        params.push([name.substring(11), content]);
      }
    }

    if (apiKeys.length > 0) {
      if (pollInterval) {
        const _interval = pollInterval;
        fhLog.trace("setting polling interval to", pollInterval);
        EdgeFeatureHubConfig.defaultEdgeServiceSupplier = (repo, config) =>
          new FeatureHubPollingClient(repo, config, parseInt(_interval));
      }

      const config = EdgeFeatureHubConfig.config(
        url || "https://app.featurehub.io/vanilla",
        apiKeys[0]!,
      );

      if (apiKeys.length > 1) {
        for (let count = 1; count < apiKeys.length; count++) {
          config.apiKey(apiKeys[count]!);
        }
      }

      const context = config.newContext();
      for (let count = 0; count < params.length; count++) {
        const value = params[count]! as [string, string];
        context.attributeValue(value[0], value[1]);
      }

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

import { EventSource, type FetchLike } from "eventsource";
import {
  ClientContext,
  connectionFromEnvironment,
  defaultEdgeTypeProviderConfig,
  EdgeFeatureHubConfig as CoreEdgeFeatureHubConfig,
  EdgeType,
  FeatureHubConfig,
  FeatureHubEventSourceClient,
  FeatureHubPollingClient,
  FeatureStateHolder,
  fhLog,
  InvalidConfigurationError,
} from "featurehub-javascript-core-sdk";

import { legacyPollingIntervalMs, nodeEnvironment } from "./environment";
import { NodejsPollingService } from "./polling_sdk";

export * from "./environment";
export * from "./polling_sdk";
export * from "./snapshot_server";
export * from "featurehub-javascript-core-sdk";

// FEATUREHUB_EDGE_URL, the API keys, and the polling and streaming timeouts and delays
// (featurehub-protocol.yaml providers.environment_variables.names); each only supplies what code does not
const environment = nodeEnvironment(process.env);
environment.warnings.forEach((w) => fhLog.warn(`[featurehubsdk] ${w}`));

/**
 * The Node SDK's config: as the core one, but a URL or API key not given in code comes from
 * FEATUREHUB_EDGE_URL and FEATUREHUB_CLIENT_API_KEY (or else FEATUREHUB_SERVER_API_KEY).
 */
export class EdgeFeatureHubConfig extends CoreEdgeFeatureHubConfig {
  public static override config(url?: string, apiKey?: string): CoreEdgeFeatureHubConfig {
    return CoreEdgeFeatureHubConfig.config(
      url || environment.edgeUrl,
      apiKey || environment.apiKey,
    );
  }

  constructor(host?: string, apiKey?: string) {
    super(host || environment.edgeUrl, apiKey || environment.apiKey);
  }
}

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
// (FEATUREHUB_POLLING_INTERVAL in milliseconds if it is a bare number, or a duration such as 30s, and
// FEATUREHUB_POLLING_PASSIVE)
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
  const legacyInterval = legacyPollingIntervalMs(process.env["FEATUREHUB_POLLING_INTERVAL"]);
  if (legacyInterval !== undefined && Number.isNaN(legacyInterval)) {
    throw new InvalidConfigurationError(
      `FEATUREHUB_POLLING_INTERVAL is "${process.env["FEATUREHUB_POLLING_INTERVAL"]}": it must be a number of ` +
        "milliseconds, or a number and a unit (ms, s, m or h) such as 30s",
    );
  }
  defaultEdgeTypeProviderConfig.defaultTimeoutInMilliseconds = legacyInterval ?? 0;
}

// the SDK makes every streaming reconnection itself in Node, so it can back off and send Last-Event-ID
FeatureHubEventSourceClient.sdkManagesReconnection = true;

FeatureHubEventSourceClient.reconnectPolicy = {
  ...FeatureHubEventSourceClient.reconnectPolicy,
  ...(environment.sseInitialRetryDelayMs !== undefined
    ? { networkErrorDelayMs: environment.sseInitialRetryDelayMs }
    : {}),
  ...(environment.sseMaxRetryDelayMs !== undefined
    ? { maxDelayMs: environment.sseMaxRetryDelayMs }
    : {}),
  ...(environment.sseBackoffMultiplier !== undefined
    ? { backoffMultiplier: environment.sseBackoffMultiplier }
    : {}),
};

/**
 * The fetch eventsource uses, sending our headers, and failing the connection (as a network error, which is
 * retried) when opening the stream takes longer than FEATUREHUB_SSE_CONNECT_TIMEOUT, or an open stream goes
 * without data for longer than FEATUREHUB_SSE_READ_TIMEOUT.
 */
function streamingFetch(headers: Record<string, string>): FetchLike {
  return async (input, init) => {
    const controller = new AbortController();
    // eventsource aborts its own signal when it closes the connection: pass that on as it is (eventsource
    // ignores an AbortError, as it caused it)
    init?.signal?.addEventListener("abort", () => controller.abort());
    // a timeout is a failed connection, so it must not look like an AbortError
    const timedOut = (what: string) => () => {
      const error = new Error(`[featurehubsdk] ${what}`);
      error.name = "FeatureHubTimeoutError";
      controller.abort(error);
    };

    const connectTimeout = environment.sseConnectTimeoutMs;
    const connectTimer = connectTimeout
      ? setTimeout(timedOut("timed out opening the stream"), connectTimeout)
      : undefined;

    try {
      const response = await fetch(input, {
        ...init,
        headers: { ...(init?.headers ?? {}), ...headers },
        signal: controller.signal,
      });

      const readTimeout = environment.sseReadTimeoutMs;
      if (!readTimeout || !response.body) {
        return response;
      }

      const readTimedOut = timedOut(
        "the stream sent nothing for longer than FEATUREHUB_SSE_READ_TIMEOUT",
      );
      let readTimer = setTimeout(readTimedOut, readTimeout);
      controller.signal.addEventListener("abort", () => clearTimeout(readTimer));

      const body = response.body.pipeThrough(
        new TransformStream<Uint8Array<ArrayBuffer>, Uint8Array<ArrayBuffer>>({
          transform(chunk, stream) {
            clearTimeout(readTimer);
            readTimer = setTimeout(readTimedOut, readTimeout);
            stream.enqueue(chunk);
          },
          flush() {
            clearTimeout(readTimer);
          },
        }),
      );

      return {
        body,
        url: response.url,
        status: response.status,
        redirected: response.redirected,
        headers: response.headers,
      };
    } finally {
      clearTimeout(connectTimer);
    }
  };
}

// we need to know how to construct a NodeJS EventSource. eventsource v3+ ignores a headers option, so the
// headers (x-featurehub, the context of a server-evaluated key) are added by the fetch it uses
FeatureHubEventSourceClient.eventSourceProvider = (url, dict) => {
  const headers = { ...((dict?.headers ?? {}) as Record<string, string>) };

  return new EventSource(url, {
    withCredentials: dict?.withCredentials ?? false,
    fetch: streamingFetch(headers),
  }) as unknown as ReturnType<typeof FeatureHubEventSourceClient.eventSourceProvider>;
};

// when a Polling Service is actually created, we need to pass the hash generator for node
// (FEATUREHUB_POLLING_REQ_TIMEOUT is how long a polling request may take, unless the code sets a timeout)
FeatureHubPollingClient.pollingClientProvider = (opt, url, freq, callback) =>
  new NodejsPollingService(
    { ...opt, timeout: opt.timeout ?? environment.pollingRequestTimeoutMs },
    url,
    freq,
    callback,
  );

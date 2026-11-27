import type { ClientContext, ContextRecord } from "./client_context";
import type { EdgeService } from "./edge_service";
import type { FeatureStateHolder } from "./feature_state";
import {
  type ConnectionEventListener,
  type EdgeServiceProvider,
  type FeatureHubRepository,
  type RawUpdateFeatureListener,
  Readyness,
  type ReadynessListener,
} from "./featurehub_repository";
import type { FeatureValueInterceptor } from "./interceptors";
import type { UsagePlugin } from "./usage/usage";

export type EdgeServiceSupplier = () => EdgeService;

export type FHLogMethod = (...args: unknown[]) => void;

export type ReadinessListenerHandle = number;
export type CatchReleaseListenerHandler = number;

export class FHLog {
  public static fhLog = new FHLog();

  public log: FHLogMethod = (...args: unknown[]) => {
    console.log("FeatureHub/Log: ", ...args);
  };

  public warn: FHLogMethod = (...args: unknown[]) => {
    console.warn("FeatureHub/Warn: ", ...args);
  };

  public error: FHLogMethod = (...args: unknown[]) => {
    console.error("FeatureHub/Error: ", ...args);
  };

  public trace: FHLogMethod = (..._args: unknown[]) => {
    // console.log('FeatureHub/Trace: ', ...args);
  };

  public quiet(): void {
    FHLog.fhLog.log = () => {};
    FHLog.fhLog.warn = () => {};
    FHLog.fhLog.error = () => {};
    FHLog.fhLog.trace = () => {};
  }
}

export const fhLog = FHLog.fhLog;

export enum EdgeType {
  STREAMING,
  REST_PASSIVE,
  REST_ACTIVE,
}

export class ConfigurationClosedError extends Error {
  constructor(method: string) {
    super(`FeatureHub config is closed — cannot call '${method}'`);
    this.name = "ConfigurationClosedError";
  }
}

/** a configuration the FeatureHub protocol does not allow, such as a poll interval under 5 seconds */
export class InvalidConfigurationError extends Error {
  constructor(message: string) {
    super(`FeatureHub configuration is invalid: ${message}`);
    this.name = "InvalidConfigurationError";
  }
}

/** no poll interval other than 0 (poll once) may be shorter than this, outside test mode */
export const MINIMUM_POLL_INTERVAL_MS = 5000;

let testPolling = false;

/**
 * Test mode only, never for production (featurehub-protocol.yaml polling_transport.interval.test_mode): when
 * on, any poll interval above 0 is allowed, and a FeatureHub pollInterval of at least 1 second is used. The
 * Node SDK turns it on from FEATUREHUB_TEST_POLLING=true. Not for applications.
 */
export function setTestPolling(enabled: boolean): void {
  testPolling = enabled;
}

/** whether test mode has lifted the poll interval minimum (setTestPolling) */
export function testPollingEnabled(): boolean {
  return testPolling;
}

/**
 * featurehub-protocol.yaml polling_transport.interval: an interval is 0 (poll once and stop) or at least 5
 * seconds; anything else is a validation error, never silently raised.
 */
export function validatePollInterval(intervalMs: number, what = "the poll interval"): number {
  if (!Number.isFinite(intervalMs) || intervalMs < 0) {
    throw new InvalidConfigurationError(
      `${what} must be 0 or a positive number of milliseconds, not ${intervalMs}`,
    );
  }

  if (intervalMs > 0 && intervalMs < MINIMUM_POLL_INTERVAL_MS && !testPolling) {
    throw new InvalidConfigurationError(
      `${what} is ${intervalMs}ms: it must be 0 (poll once) or at least ${MINIMUM_POLL_INTERVAL_MS}ms`,
    );
  }

  return intervalMs;
}

/**
 * Headers an application sends to FeatureHub Edge with every poll and every streaming connection (for an API
 * gateway, a proxy, extra authentication or tracing). A function is called for each request and connection,
 * so a header such as a rotating token stays current.
 */
export type ExtraHeaders = Record<string, string> | (() => Record<string, string>);

// headers the SDK itself sends: an application's header of the same name (in any case) is never sent
const PROTOCOL_HEADERS = ["x-featurehub", "if-none-match", "last-event-id"];

/**
 * The extra headers a config has, without any that would clash with the SDK's own protocol headers
 * (featurehub-protocol.yaml featurehub_edge.extra_headers.precedence). Header names are case-insensitive,
 * so a clash is found whatever its case.
 */
export function configExtraHeaders(config: FeatureHubConfig): Record<string, string> {
  const headers = typeof config.extraHeaders === "function" ? config.extraHeaders() : undefined;

  if (headers === null || typeof headers !== "object") {
    return {};
  }

  return Object.fromEntries(
    Object.entries(headers).filter(
      ([name, value]) =>
        typeof value === "string" && !PROTOCOL_HEADERS.includes(name.toLowerCase()),
    ),
  );
}

/** the query string a config's host was given with, if it has one */
export function configHostQuery(config: FeatureHubConfig): string {
  const query = typeof config.hostQuery === "function" ? config.hostQuery() : undefined;
  return typeof query === "string" ? query : "";
}

export interface FeatureHubConfig {
  /**
   * indicates the system is ready
   * @deprecated used readiness
   */
  readyness: Readyness;

  /**
   * Whether this config has been permanently closed.
   */
  get isClosed(): boolean;

  readiness: Readyness;

  /**
   * When using a Server Evaluated key, we only have one context so we can get the features directly from the
   * config
   * @param name
   */

  feature(name: string): FeatureStateHolder;

  url(): string;

  // enable you to override the repository
  repository(repository?: FeatureHubRepository): FeatureHubRepository;

  // allow you to override the edge service provider, not required any longer because
  // of the control of the edge type via the restActive(), restPassive() and streaming() functions
  edgeServiceProvider(edgeService?: EdgeServiceProvider): EdgeServiceProvider;

  context(context?: ContextRecord): ClientContext;

  // create a new context and allow you to pass in a repository and edge service
  newContext(repository?: FeatureHubRepository, edgeService?: EdgeServiceProvider): ClientContext;

  // is the repository client-side evaluated?
  clientEvaluated(): boolean;

  // this only works when the config is in no-op mode and will through an error otherwise
  set isClientEvaluated(clientEvaluated: boolean);

  // add another API key
  apiKey(apiKey: string): FeatureHubConfig;

  // what are the API keys?
  getApiKeys(): Array<string>;

  // what is the host?
  getHost(): string;

  // the query string the host was given with (without the "?"), sent before the SDK's own parameters
  hostQuery?(): string;

  // this is the fully constructed URL depending on if you are using polling or streaming
  featureUrl(): string;

  // initialize the connection outside of the creation of a context
  init(): FeatureHubConfig;

  /**
   * Waits until the repository reaches Ready state, polling every 200ms. Ensures the edge service
   * has had its poll method called. Returns the final Readyness state.
   *
   * @param timeoutMs - maximum time to wait in milliseconds (default: 10000)
   */
  waitForReady(timeoutMs?: number): Promise<Readyness>;

  // close any server connections
  close(): void;

  /**
   * Tears down the edge connection(s), repository and usage plugin immediately,
   * ignoring how many consumers still hold a reference to the config. Use this
   * when the owner of the config is shutting down for good (e.g. an OpenFeature
   * provider's `onClose`), where reference-counted `close()` may never reach
   * zero.
   */
  forceClose(): void;

  // close just the server connection leaving the repository, etc open. This allows a web page for
  // example to close connections and tidy up, or leave it open for re-opening again because the config
  // is loaded into the `window` context.
  closeEdge(): void;

  /**
   * Is this config open or closed? If closed it has no edge connections
   */
  get closed(): boolean;

  /**
   * if initialized, it means initialize has been called
   */
  get initialized(): boolean;

  /**
   * add a callback for when the system is ready
   * @deprecated - use addReadinessListener
   * @param listener
   */
  addReadynessListener(listener: ReadynessListener): ReadinessListenerHandle;

  /**
   * Adds a listener and returns a new handle to allow us to remove the listener. This will always trigger the
   * registered listener with the current state unless ignoreNotReadyOnRegister is set to true.
   *
   * @param listener - the listener to trigger when readiness changes
   * @param ignoreNotReadyOnRegister - if true and the readyness state is NotReady, will not fire. You would use this
   * if you register your readiness listener before initialising the repository so you don't get an immediate NotReady
   * trigger.
   */
  addReadinessListener(
    listener: ReadynessListener,
    ignoreNotReadyOnRegister?: boolean,
  ): ReadinessListenerHandle;
  removeReadinessListener(handle: ReadynessListener | ReadinessListenerHandle): void;

  /**
   * The connection has permanently failed and will send nothing more (featurehub-protocol.yaml
   * repository.connection_failed). With features already held, readiness is Stale and they keep resolving.
   */
  get connectionFailed(): boolean;

  /**
   * The source says the environment is stale and will send no further updates (featurehub-protocol.yaml
   * repository.environment_stale). Readiness is Stale and the last features keep resolving.
   */
  get environmentStale(): boolean;

  /**
   * Adds a listener for the connection stopping for good (ConnectionEvent.ConnectionFailed or
   * EnvironmentStale), each told once and separately from readiness, which may already be Stale (during a
   * context change) when it happens. An event that has already happened is told at once. A provider uses it
   * to report STALE.
   */
  addConnectionEventListener(listener: ConnectionEventListener): ReadinessListenerHandle;
  removeConnectionEventListener(handle: ConnectionEventListener | ReadinessListenerHandle): void;

  // add a value interceptor (e.g. baggage handler)
  addValueInterceptor(interceptor: FeatureValueInterceptor): void;
  registerRawUpdateFeatureListener(listener: RawUpdateFeatureListener): void;

  addUsagePlugin(plugin: UsagePlugin): FeatureHubConfig;

  restActive(intervalInMilliseconds?: number): FeatureHubConfig;

  restPassive(cacheTimeoutInMilliseconds?: number): FeatureHubConfig;

  streaming(): FeatureHubConfig;

  /**
   * Headers to send to FeatureHub Edge with every poll and every streaming connection and reconnection. The
   * SDK's own protocol headers (x-featurehub, If-None-Match, Last-Event-ID) always win over one of the same
   * name. A browser's EventSource cannot send headers, so in a browser they are only sent when polling.
   */
  headers(headers: ExtraHeaders | undefined): FeatureHubConfig;

  /** the extra headers to send now */
  extraHeaders?(): Record<string, string>;

  // internal APIs
  get edgeType(): EdgeType;
  get edgeSupplierTimeout(): number;
  get environmentId(): string;

  // this only works in no-op mode because an ID is required generally
  set environmentId(envId: string);

  get isReady(): boolean;
}

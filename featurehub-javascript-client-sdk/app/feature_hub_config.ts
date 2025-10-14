import { EdgeService } from "./edge_service";
import { ClientContext } from "./client_context";
import { InternalFeatureRepository } from "./internal_feature_repository";
import { AnalyticsCollector } from "./analytics";
import { FeatureStateValueInterceptor } from "./interceptors";
import { FeatureHubRepository, Readyness, ReadynessListener } from "./featurehub_repository";
import { FeatureStateHolder } from "./feature_state";

export type EdgeServiceProvider = (
  repository: InternalFeatureRepository,
  // eslint-disable-next-line no-use-before-define
  config: FeatureHubConfig,
) => EdgeService;
export type EdgeServiceSupplier = () => EdgeService;

export type FHLogMethod = (...args: any[]) => void;

export type ReadinessListenerHandle = number;
export type CatchReleaseListenerHandler = number;

export class FHLog {
  public static fhLog = new FHLog();

  public log: FHLogMethod = (...args: any[]) => {
    console.log("FeatureHub/Log: ", ...args);
  };

  public error: FHLogMethod = (...args: any[]) => {
    console.error("FeatureHub/Error: ", ...args);
  };

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public trace: FHLogMethod = (...args: any[]) => {
    // console.log('FeatureHub/Trace: ', ...args);
  };

  public quiet(): void {
    FHLog.fhLog.log = () => {};
    FHLog.fhLog.error = () => {};

    FHLog.fhLog.trace = () => {};
  }
}

export const fhLog = FHLog.fhLog;

export interface FeatureHubConfig {
  /**
   * indicates the system is ready
   * @deprecated used readiness
   */
  readyness: Readyness;

  readiness: Readyness;

  /**
   * When using a Server Evaluated key, we only have one context so we can get the features directly from the
   * config
   * @param name
   */
  feature<T = any>(name: string): FeatureStateHolder<T>;

  url(): string;

  // enable you to override the repository
  repository(repository?: FeatureHubRepository): FeatureHubRepository;

  // allow you to override the edge service provider
  edgeServiceProvider(edgeService?: EdgeServiceProvider): EdgeServiceProvider;

  // create a new context and allow you to pass in a repository and edge service
  newContext(repository?: FeatureHubRepository, edgeService?: EdgeServiceProvider): ClientContext;

  // is the repository client-side evaluated?
  clientEvaluated(): boolean;

  // add another API key
  apiKey(apiKey: string): FeatureHubConfig;

  // what are the API keys?
  getApiKeys(): Array<string>;

  // what is the host?
  getHost(): string;

  // initialize the connection outside of the creation of a context
  init(): FeatureHubConfig;

  // close any server connections
  close(): void;

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
  removeReadinessListener(handle: ReadynessListener | ReadinessListenerHandle);

  // add an analytics collector
  addAnalyticCollector(collector: AnalyticsCollector): void;

  // add a value interceptor (e.g. baggage handler)
  addValueInterceptor(interceptor: FeatureStateValueInterceptor): void;
}

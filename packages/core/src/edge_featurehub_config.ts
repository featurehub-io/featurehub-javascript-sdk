import type { ClientContext, ContextRecord } from "./client_context";
import { ClientFeatureRepository } from "./client_feature_repository";
import { ClientEvalFeatureContext, ServerEvalFeatureContext } from "./context_impl";
import type { EdgeService } from "./edge_service";
import {
  ConfigurationClosedError,
  EdgeType,
  type FeatureHubConfig,
  fhLog,
} from "./feature_hub_config";
import type { FeatureStateHolder } from "./feature_state";
import {
  type EdgeServiceProvider,
  Readyness,
  type ReadynessListener,
} from "./featurehub_repository";
import type { FeatureValueInterceptor } from "./interceptors";
import type { InternalFeatureRepository } from "./internal_feature_repository";
import { FeatureHubNetwork } from "./network";
import {
  DefaultUsagePlugin,
  isUsageEventWithFeature,
  type UsageEvent,
  type UsagePlugin,
} from "./usage/usage";
import { UsageAdapter } from "./usage/usage_adapter";

export const defaultEdgeTypeProviderConfig = {
  defaultTimeoutInMilliseconds: 180000,
  defaultEdgeProvider: EdgeType.REST_ACTIVE,
};

// this is an async plugin so the process of polling will become async
class PassiveRestUsagePlugin extends DefaultUsagePlugin {
  private readonly _config: EdgeFeatureHubConfig;

  constructor(config: EdgeFeatureHubConfig) {
    super();
    this._config = config;
  }

  send(event: UsageEvent): void {
    if (
      isUsageEventWithFeature(event) &&
      this._config.edgeType === EdgeType.REST_PASSIVE &&
      this._config.edgeConnected
    ) {
      this._config.edgePollFromUsage();
    }
  }
}

class NoopEdgeService implements EdgeService {
  contextChange(_header: string): Promise<void> {
    return Promise.resolve();
  }

  clientEvaluated(): boolean {
    return false;
  }

  requiresReplacementOnHeaderChange(): boolean {
    return false;
  }

  close(): void {}

  poll(_fromUsage?: boolean): Promise<void> {
    return Promise.resolve();
  }
}

const noopEdgeServiceProvider: EdgeServiceProvider = () => new NoopEdgeService();

export class EdgeFeatureHubConfig implements FeatureHubConfig {
  private readonly _host: string;
  private readonly _originalUrl: string;
  private readonly _apiKey: string;
  private readonly _apiKeys: Array<string>;
  private _clientEval: boolean;
  private readonly _url: string;
  private _repository: InternalFeatureRepository | undefined;
  private _edgeService: EdgeServiceProvider | undefined;
  private _edgeServices: Array<EdgeService> = [];
  private _clientContext: ServerEvalFeatureContext | undefined;
  private _initialized = false;
  private _usageAdapter: UsageAdapter | undefined;
  private _timeout: number | undefined = undefined;
  private _edgeType: EdgeType = EdgeType.STREAMING;
  private readonly _noopMode: boolean;

  private _isClosed = false;

  private static _singleton: EdgeFeatureHubConfig | undefined;

  public static config(url?: string, apiKey?: string): EdgeFeatureHubConfig {
    if (EdgeFeatureHubConfig._singleton) {
      if (
        EdgeFeatureHubConfig._singleton._originalUrl == (url ?? "") &&
        EdgeFeatureHubConfig._singleton._apiKey == (apiKey ?? "")
      ) {
        return EdgeFeatureHubConfig._singleton;
      }

      EdgeFeatureHubConfig._singleton.forceClose();
    }

    EdgeFeatureHubConfig._singleton = new EdgeFeatureHubConfig(url, apiKey);

    return EdgeFeatureHubConfig._singleton;
  }

  constructor(host?: string, apiKey?: string) {
    this._edgeType = defaultEdgeTypeProviderConfig.defaultEdgeProvider;
    this._timeout = defaultEdgeTypeProviderConfig.defaultTimeoutInMilliseconds;

    if (!host || !apiKey) {
      this._noopMode = true;
      this._apiKey = "";
      this._originalUrl = "";
      this._host = "";
      this._url = "";
      this._apiKeys = [];
      this._clientEval = true;

      fhLog.trace(`creating new featurehub config in noop mode (no edge connection).`);
      return;
    }

    this._noopMode = false;
    this._apiKey = apiKey;
    this._originalUrl = host;
    this._host = host;

    fhLog.trace(
      `creating new featurehub config with edge type ${this._edgeType} and timeout ${this._timeout}.`,
    );

    this._apiKeys = [apiKey];

    this._clientEval = this._apiKey.includes("*");

    if (!this._host.endsWith("/")) {
      this._host += "/";
    }

    if (this._host.endsWith("/features/")) {
      this._host = this._host.substring(0, this._host.length - ("/features/".length - 1));
    }

    this._url = this._host + "features/" + this._apiKey;
  }

  /**
   * @deprecated use addReadinessListener
   * @param listener
   */
  public addReadynessListener(listener: ReadynessListener): number {
    return this.addReadinessListener(listener);
  }

  public addValueInterceptor(interceptor: FeatureValueInterceptor): void {
    if (this._isClosed) return;
    this.repository().addValueInterceptor(interceptor);
  }

  public get readyness(): Readyness {
    if (this._isClosed) return Readyness.NotReady;
    return this.repository().readyness;
  }

  public get readiness(): Readyness {
    if (this._isClosed) return Readyness.NotReady;
    return this.repository().readyness;
  }

  public feature<T = any>(name: string): FeatureStateHolder<T> {
    if (this._isClosed) throw new ConfigurationClosedError("feature");
    if (this.clientEvaluated()) {
      throw new Error(
        "You cannot use this method for client evaluated keys, please get a context with .newContext()",
      );
    }

    return this.newContext().feature(name);
  }

  public apiKey(apiKey: string): FeatureHubConfig {
    this._apiKeys.push(apiKey);
    return this;
  }

  public clientEvaluated(): boolean {
    return this._clientEval;
  }

  getApiKeys(): string[] {
    return Object.assign([], this._apiKeys);
  }

  getHost(): string {
    return this._host;
  }

  context(context?: ContextRecord): ClientContext {
    if (this._isClosed) throw new ConfigurationClosedError("context");
    const ctx = this.newContext();

    if (context) {
      ctx.attributes = context;
    }

    return ctx;
  }

  newContext(
    repository?: InternalFeatureRepository,
    edgeService?: EdgeServiceProvider,
  ): ClientContext {
    if (this._isClosed) throw new ConfigurationClosedError("newContext");
    repository = repository || this.repository();
    edgeService = edgeService || this.edgeServiceProvider();

    if (this._clientEval) {
      return new ClientEvalFeatureContext(
        repository,
        this.getOrCreateEdgeService(edgeService, repository),
      );
    }

    // if they are using a server evaluated key, then we don't change the context, we tell the context about the
    // updated context and it refreshes the existing connection.
    if (!this._clientContext) {
      this._clientContext = new ServerEvalFeatureContext(repository, () =>
        this.getOrCreateEdgeService(edgeService!, repository),
      );
    }

    // we are reference counting the client
    this._clientContext.addClient();

    return this._clientContext;
  }

  public get edgeConnected(): boolean {
    return this._edgeServices.length > 0;
  }

  public edgePollFromUsage() {
    if (this._isClosed) return;
    this._edgeServices.forEach((e) => e.poll(true));
  }

  private getOrCreateEdgeService(
    edgeServSupplier: EdgeServiceProvider,
    repository?: InternalFeatureRepository,
  ): EdgeService {
    if (this._edgeServices.length === 0) {
      return this.createEdgeService(edgeServSupplier, repository);
    }

    return this._edgeServices[0]!;
  }

  private createEdgeService(
    edgeServSupplier: EdgeServiceProvider,
    repository?: InternalFeatureRepository,
  ): EdgeService {
    const es = edgeServSupplier(
      repository || this.repository(),
      this,
      this._edgeType,
      this._timeout || defaultEdgeTypeProviderConfig.defaultTimeoutInMilliseconds,
    );

    this._initialized = true;

    this._edgeServices.push(es);
    return es;
  }

  close(): void {
    if (this._isClosed) return;
    // we can have multiple consumers of the ServerEval context, and they may issue closes on this, which we don't want
    if (this._clientContext) {
      if (this._clientContext.removeClient()) {
        this.forceClose();
      }
    } else {
      this.forceClose();
    }
  }

  forceClose(): void {
    fhLog.trace(`force close requested`);
    this._edgeServices.forEach((es) => {
      es.close();
    });
    this._edgeServices.length = 0;
    this._initialized = false;
    this._isClosed = true;
    this._usageAdapter?.close();
    this._usageAdapter = undefined;
    this._repository?.close();
    this._repository = undefined;
    this._edgeService = undefined;
    this._clientContext = undefined;
  }

  get isClosed(): boolean {
    return this._isClosed;
  }

  get closed(): boolean {
    return !this._initialized;
  }

  get initialized(): boolean {
    return this._initialized;
  }

  init(): FeatureHubConfig {
    if (this._isClosed) return this;
    if (!this._initialized) {
      // ensure the repository exists
      this.repository();

      // ensure the edge service provider exists
      this.getOrCreateEdgeService(this.edgeServiceProvider())
        .poll()
        .catch((e) => fhLog.error(`Failed to connect to FeatureHub Edge ${e}`));
    }

    return this;
  }

  edgeServiceProvider(edgeServ?: EdgeServiceProvider): EdgeServiceProvider {
    if (this._isClosed) throw new ConfigurationClosedError("edgeServiceProvider");
    if (edgeServ != null) {
      this._edgeService = edgeServ;
    } else if (this._edgeService == null) {
      this._edgeService = this._noopMode
        ? noopEdgeServiceProvider
        : FeatureHubNetwork.defaultEdgeServiceSupplier;
    }

    return this._edgeService;
  }

  addUsagePlugin(plugin: UsagePlugin): FeatureHubConfig {
    if (this._isClosed) return this;
    if (!this._initialized || !this._repository) {
      this.repository();
    }

    this._usageAdapter!.registerPlugin(plugin);

    return this;
  }

  repository(repository?: InternalFeatureRepository): InternalFeatureRepository {
    if (this._isClosed) throw new ConfigurationClosedError("repository");
    if (repository != null) {
      this._repository = repository;
    } else if (this._repository == null) {
      this._repository = new ClientFeatureRepository();
    }

    this._usageAdapter = new UsageAdapter(this._repository);
    this._usageAdapter.registerPlugin(new PassiveRestUsagePlugin(this));

    return this._repository;
  }

  url(): string {
    return this._url;
  }

  featureUrl(): string {
    if (this.edgeType === EdgeType.STREAMING) {
      return `${this._url}/features/${this._apiKey}`;
    }

    return `${this._url}/features?${this._apiKeys.map((a) => "apiKey=" + a).join("&")}`;
  }

  addReadinessListener(listener: ReadynessListener, ignoreNotReadyOnRegister?: boolean): number {
    if (this._isClosed) throw new ConfigurationClosedError("addReadinessListener");
    return this.repository().addReadinessListener(listener, ignoreNotReadyOnRegister);
  }

  removeReadinessListener(listener: ReadynessListener | number) {
    if (this._isClosed) return;
    this.repository().removeReadinessListener(listener);
  }

  restActive(intervalInMilliseconds?: number): FeatureHubConfig {
    if (this._isClosed) return this;
    if (intervalInMilliseconds) {
      this._timeout = intervalInMilliseconds;
    }

    this._edgeType = EdgeType.REST_ACTIVE;
    return this;
  }

  restPassive(cacheTimeoutInMilliseconds?: number): FeatureHubConfig {
    if (this._isClosed) return this;
    if (cacheTimeoutInMilliseconds) {
      this._timeout = cacheTimeoutInMilliseconds;
    }

    this._edgeType = EdgeType.REST_PASSIVE;

    return this;
  }

  streaming(): FeatureHubConfig {
    if (this._isClosed) return this;
    this._edgeType = EdgeType.STREAMING;
    return this;
  }

  get edgeSupplierTimeout(): number {
    return this._timeout || defaultEdgeTypeProviderConfig.defaultTimeoutInMilliseconds;
  }

  get edgeType(): EdgeType {
    return this._edgeType;
  }

  get environmentId(): string {
    const parts = this._apiKey.split("/");

    if (parts.length >= 3) {
      return parts[1]!;
    }

    if (parts.length == 2) {
      return parts[0]!;
    }

    return "<unknown>";
  }
}

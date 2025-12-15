import type { AnalyticsCollector } from "./analytics";
import type { ClientContext } from "./client_context";
import { ClientFeatureRepository } from "./client_feature_repository";
import { ClientEvalFeatureContext, ServerEvalFeatureContext } from "./context_impl";
import type { EdgeService } from "./edge_service";
import { type EdgeServiceProvider, type FeatureHubConfig, fhLog } from "./feature_hub_config";
import type { FeatureStateHolder } from "./feature_state";
import { Readyness, type ReadynessListener } from "./featurehub_repository";
import type { FeatureStateValueInterceptor } from "./interceptors";
import type { InternalFeatureRepository } from "./internal_feature_repository";
import { FeatureHubPollingClient } from "./polling_sdk";

export class EdgeFeatureHubConfig implements FeatureHubConfig {
  private _host: string;
  private _apiKey: string;
  private _apiKeys: Array<string>;
  private _clientEval: boolean;
  private _url: string;
  private _repository: InternalFeatureRepository | undefined;
  private _edgeService: EdgeServiceProvider | undefined;
  private _edgeServices: Array<EdgeService> = [];
  private _clientContext: ServerEvalFeatureContext | undefined;
  private _initialized = false;

  static defaultEdgeServiceSupplier: EdgeServiceProvider = (repository, config) =>
    new FeatureHubPollingClient(repository, config, 30000);

  private static _singleton: any | undefined;

  public static config(url: string, apiKey: string): EdgeFeatureHubConfig {
    if (EdgeFeatureHubConfig._singleton) {
      if (
        EdgeFeatureHubConfig._singleton._originalUrl == url &&
        EdgeFeatureHubConfig._singleton._apiKey == apiKey
      ) {
        return EdgeFeatureHubConfig._singleton;
      }

      EdgeFeatureHubConfig._singleton.forceClose();
    }

    EdgeFeatureHubConfig._singleton = new EdgeFeatureHubConfig(url, apiKey);

    return EdgeFeatureHubConfig._singleton;
  }

  constructor(host: string, apiKey: string) {
    this._apiKey = apiKey;
    this._host = host;

    fhLog.trace("creating new featurehub config.");

    if (apiKey == null || host == null) {
      throw new Error("apiKey and host must not be null");
    }

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

  public addAnalyticCollector(collector: AnalyticsCollector): void {
    this.repository().addAnalyticCollector(collector);
  }

  public addValueInterceptor(interceptor: FeatureStateValueInterceptor): void {
    this.repository().addValueInterceptor(interceptor);
  }

  public get readyness(): Readyness {
    return this.repository().readyness;
  }

  public get readiness(): Readyness {
    return this.repository().readyness;
  }

  public feature<T = any>(name: string): FeatureStateHolder<T> {
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

  newContext(
    repository?: InternalFeatureRepository,
    edgeService?: EdgeServiceProvider,
  ): ClientContext {
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
    const es = edgeServSupplier(repository || this.repository(), this);

    this._initialized = true;

    this._edgeServices.push(es);
    return es;
  }

  close(): void {
    // we can have multiple consumers of the ServerEval context, and they may issue closes on this, which we don't want
    if (this._clientContext) {
      if (this._clientContext.removeClient()) {
        this.forceClose();
        this._clientContext = undefined;
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
  }

  get closed(): boolean {
    return !this._initialized;
  }
  get initialized(): boolean {
    return this._initialized;
  }

  init(): FeatureHubConfig {
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
    if (edgeServ != null) {
      this._edgeService = edgeServ;
    } else if (this._edgeService == null) {
      this._edgeService = EdgeFeatureHubConfig.defaultEdgeServiceSupplier;
    }

    return this._edgeService;
  }

  repository(repository?: InternalFeatureRepository): InternalFeatureRepository {
    if (repository != null) {
      this._repository = repository;
    } else if (this._repository == null) {
      this._repository = new ClientFeatureRepository();
    }

    return this._repository;
  }

  url(): string {
    return this._url;
  }

  addReadinessListener(listener: ReadynessListener, ignoreNotReadyOnRegister?: boolean): number {
    return this.repository().addReadinessListener(listener, ignoreNotReadyOnRegister);
  }

  removeReadinessListener(listener: ReadynessListener | number) {
    this.repository().removeReadinessListener(listener);
  }
}

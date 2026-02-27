import {
  caToString,
  type ClientContext,
  type ContextAttribute,
  type ContextRecord,
} from "./client_context";
import type { EdgeService } from "./edge_service";
import { type EdgeServiceSupplier, type FeatureHubConfig, fhLog } from "./feature_hub_config";
import type { FeatureStateHolder } from "./feature_state";
import type { FeatureHubRepository } from "./featurehub_repository";
import type { InternalFeatureRepository } from "./internal_feature_repository";
import {
  FeatureValueType,
  StrategyAttributeCountryName,
  StrategyAttributeDeviceName,
  StrategyAttributePlatformName,
} from "./models";
import { type UsageEvent } from "./usage/usage";

export abstract class BaseClientContext implements ClientContext {
  protected readonly _repository: InternalFeatureRepository;
  protected _currentEdge: EdgeService | undefined;

  protected _userKey: string | undefined = undefined;
  protected _attributes = new Map<string, ContextAttribute>();

  protected constructor(repository: InternalFeatureRepository) {
    this._repository = repository;
  }

  private setOrClear(key: string, value: ContextAttribute | undefined): ClientContext {
    if (value === undefined) {
      this._attributes.delete(key);
    } else {
      this._attributes.set(key, value);
    }

    return this;
  }

  userKey(value: string | undefined): ClientContext {
    this._userKey = value;
    return this;
  }

  sessionKey(value: string | undefined): ClientContext {
    return this.setOrClear("session", value);
  }

  country(value: StrategyAttributeCountryName | undefined): ClientContext {
    return this.setOrClear("country", value);
  }

  device(value: StrategyAttributeDeviceName | undefined): ClientContext {
    return this.setOrClear("device", value);
  }

  platform(value: StrategyAttributePlatformName | undefined): ClientContext {
    return this.setOrClear("platform", value);
  }

  version(version: string | undefined): ClientContext {
    return this.setOrClear("version", version);
  }

  attributeValue(key: string, value: ContextAttribute | undefined): ClientContext {
    return this.setOrClear(key, value);
  }

  clear(): ClientContext {
    this._attributes.clear();
    return this;
  }

  get attributes(): ContextRecord {
    const base = this._userKey ? { userkey: this._userKey } : {};
    return Object.assign(base, Object.fromEntries(this._attributes.entries()));
  }

  set attributes(data: ContextRecord) {
    // copy everything except the user key
    Object.entries(data).forEach(([key, val]) => {
      if (key !== "userkey") {
        this._attributes.set(key, val);
      }
    });
  }

  getAttr(key: string, defaultValue?: ContextAttribute): ContextAttribute | undefined {
    if (key === "userkey") {
      return this._userKey;
    }

    if (this._attributes.has(key)) {
      return this._attributes.get(key);
    }

    return defaultValue;
  }

  defaultPercentageKey(): string | undefined {
    return this._attributes.has("session")
      ? this._attributes.get("session")?.toString()
      : this._userKey;
  }

  // ---- feature related

  isEnabled(name: string): boolean {
    return this.feature(name).isEnabled();
  }

  isSet(name: string): boolean {
    return this.feature(name).isSet();
  }

  getNumber(name: string, def?: number): number | undefined {
    const fsh = this.feature(name);
    return fsh.isSet() ? fsh.getNumber() : def;
  }

  getString(name: string, def?: string): string | undefined {
    const fsh = this.feature(name);
    return fsh.isSet() ? fsh.getString() : def;
  }

  getJson(name: string, def?: unknown): unknown | undefined {
    const fsh = this.feature(name);
    if (fsh.isSet()) {
      const val = fsh.getRawJson();
      return JSON.parse(val!);
    } else {
      return def;
    }
  }

  getRawJson(name: string, def?: string): string | undefined {
    const fsh = this.feature(name);
    return fsh.isSet() ? fsh.getRawJson() : def;
  }

  getFlag(name: string, def?: boolean): boolean | undefined {
    const fsh = this.feature(name);
    return fsh.isSet() ? fsh.getBoolean() : def;
  }

  getBoolean(name: string, def?: boolean): boolean | undefined {
    const fsh = this.feature(name);
    return fsh.isSet() ? fsh.getBoolean() : def;
  }

  abstract build(): Promise<ClientContext>;

  abstract feature(name: string): FeatureStateHolder;
  // feature(name: string): FeatureStateHolder {
  //   return this._repository.feature(name);
  // }
  abstract close(): void;

  repository(): FeatureHubRepository {
    return this._repository;
  }

  // --- usage tracking

  usageUserKey() {
    return this._userKey || this.getAttr("session")?.toString();
  }

  private get usageAttributes(): ContextRecord {
    return Object.assign({}, Object.fromEntries(this._attributes.entries()));
  }

  used(
    key: string,
    id: string,
    value: string | number | boolean | undefined,
    valueType: FeatureValueType,
  ): void {
    const usageProvider = this._repository.usageProvider;
    this.recordUsageEvent(
      usageProvider.createUsageFeature(
        usageProvider.createFeatureHubUsageValueFromFields(id, key, value, valueType),
        this.usageAttributes,
        this.usageUserKey(),
      ),
    );

    // because we evaluated a feature, we might be allowed to poll for a new one
    this._currentEdge?.poll(true);
  }

  protected recordFeatureChangedForUser(feature: FeatureStateHolder) {
    const usageProvider = this._repository.usageProvider;
    this._repository.recordUsageEvent(
      usageProvider.createUsageFeature(
        usageProvider.createFeatureHubUsageValue(feature.withContext(this)),
        this.usageAttributes,
        this.usageUserKey(),
      ),
    );
  }

  protected recordRelativeValuesForUser(): void {
    this.recordUsageEvent(this._repository.usageProvider.createUsageContextCollectionEvent());
  }

  protected mapRepositoryFeaturesToUsageValues() {
    return this._repository.serverProvidedFeatureKeys.map((k) =>
      this._repository.usageProvider.createFeatureHubUsageValue(this._repository.feature(k)),
    );
  }

  public fillEvent(event: any | UsageEvent): any {
    if (Object.hasOwn(event, "userKey")) {
      event.userKey = this.usageUserKey();
    } else if (typeof event.userKey === "function") {
      event.userKey(this.usageUserKey());
    }

    if (Object.hasOwn(event, "featureValues")) {
      event.featureValues = this.mapRepositoryFeaturesToUsageValues();
    } else if (typeof event.featureValues === "function") {
      event.featureValues(this.mapRepositoryFeaturesToUsageValues());
    }

    if (Object.hasOwn(event, "contextAttributes")) {
      event.contextAttributes = this.usageAttributes;
    } else if (typeof event.contextAttributes === "function") {
      event.contextAttributes = this.usageAttributes;
    }

    return event;
  }

  recordUsageEvent(event: any | UsageEvent): any {
    this._repository.recordUsageEvent(this.fillEvent(event));
  }

  recordNamedUsage(name: string, additionalParams?: Record<string, any>): void {
    this._repository.recordUsageEvent(
      this.fillEvent(
        this._repository.usageProvider.createNamedUsageCollection(name, additionalParams),
      ),
    );
  }

  getContextUsage(): UsageEvent {
    return this.fillEvent(this._repository.usageProvider.createUsageContextCollectionEvent());
  }
}

export class ServerEvalFeatureContext extends BaseClientContext {
  private readonly _edgeServiceSupplier: EdgeServiceSupplier;
  private _config?: FeatureHubConfig;
  private _xHeader: string | undefined;
  private _clientCount = 0;
  private readonly newFeatureStateHandler;

  constructor(
    repository: InternalFeatureRepository,
    edgeServiceSupplier: EdgeServiceSupplier,
    config?: FeatureHubConfig,
  ) {
    super(repository);

    this._edgeServiceSupplier = edgeServiceSupplier;
    this._config = config;

    // a feature has updated its state
    this.newFeatureStateHandler = repository.addPostLoadNewFeatureStateAvailableListener(() => {
      this.recordRelativeValuesForUser();
    });
  }

  addClient(): void {
    this._clientCount += 1;
  }

  removeClient(): boolean {
    this._clientCount -= 1;
    return this._clientCount <= 0;
  }

  async build(): Promise<ClientContext> {
    try {
      const newHeader = Object.entries(this.attributes)
        .map((key) => key[0] + "=" + encodeURIComponent(caToString(key[1])))
        .sort()
        .join(",");

      if (newHeader !== this._xHeader) {
        this._xHeader = newHeader;
        this._repository.notReady();

        if (this._currentEdge != null && this._currentEdge.requiresReplacementOnHeaderChange()) {
          fhLog.trace(
            "We are changing the contextSha and have to close the existing polling connection.",
          );
          this._currentEdge.close();
          this._currentEdge = undefined;
        }
      }

      if (this._currentEdge === undefined) {
        this._currentEdge = this._edgeServiceSupplier();
      }

      if (this._currentEdge !== undefined) {
        await this._currentEdge.contextChange(this._xHeader);
      }
    } catch (e) {
      if (e) {
        fhLog.error("Failed to connect to FeatureHHub Edge to refresh context", e);
      }
    }

    return this;
  }

  close(): void {
    if (this._clientCount <= 1 && this._config !== undefined) {
      fhLog.trace("closing because client count is ", this._clientCount);
      this._config.close(); // tell the config to close us down
      this._repository.removePostLoadNewFeatureStateAvailableListener(this.newFeatureStateHandler);
    } else if (this._currentEdge) {
      fhLog.trace("closing because directly requested close.");
      this._currentEdge.close();
    }
  }

  edgeService(): EdgeService | undefined {
    return this._currentEdge;
  }

  feature(name: string): FeatureStateHolder {
    return this._repository.feature(name);
  }
}

export class ClientEvalFeatureContext extends BaseClientContext {
  constructor(repository: InternalFeatureRepository, edgeService: EdgeService) {
    super(repository);

    this._currentEdge = edgeService;
  }

  async build(): Promise<ClientContext> {
    this._currentEdge!.poll()
      ?.then(() => {})
      .catch(() => {}); // in case it hasn't already been initialized

    return this;
  }

  close(): void {
    this._currentEdge!.close();
  }

  edgeService(): EdgeService {
    return this._currentEdge!;
  }

  feature(name: string): FeatureStateHolder {
    return this._repository.feature(name).withContext(this);
  }
}

import type { ClientContext } from "./client_context";
import type { EdgeService } from "./edge_service";
import { type EdgeServiceSupplier, type FeatureHubConfig, fhLog } from "./feature_hub_config";
import type { FeatureStateHolder } from "./feature_state";
import type { FeatureHubRepository } from "./featurehub_repository";
import type { InternalFeatureRepository } from "./internal_feature_repository";
import {
  StrategyAttributeCountryName,
  StrategyAttributeDeviceName,
  StrategyAttributePlatformName,
} from "./models";

export abstract class BaseClientContext implements ClientContext {
  protected readonly _repository: InternalFeatureRepository;

  protected _attributes = new Map<string, Array<string>>();

  protected constructor(repository: InternalFeatureRepository) {
    this._repository = repository;
  }

  userKey(value: string): ClientContext {
    this._attributes.set("userkey", [value]);
    return this;
  }

  sessionKey(value: string): ClientContext {
    this._attributes.set("session", [value]);
    return this;
  }

  country(value: StrategyAttributeCountryName): ClientContext {
    this._attributes.set("country", [value]);
    return this;
  }

  device(value: StrategyAttributeDeviceName): ClientContext {
    this._attributes.set("device", [value]);
    return this;
  }

  platform(value: StrategyAttributePlatformName): ClientContext {
    this._attributes.set("platform", [value]);
    return this;
  }

  version(version: string): ClientContext {
    this._attributes.set("version", [version]);
    return this;
  }

  /**
   * @deprecated - use attributeValue
   * @param key
   * @param value
   */

  attribute_value(key: string, value: string): ClientContext {
    return this.attributeValue(key, value);
  }

  attributeValue(key: string, value: string): ClientContext {
    this._attributes.set(key, [value]);
    return this;
  }

  /**
   * @deprecated - use attributeValues
   * @param key
   * @param values
   */

  attribute_values(key: string, values: Array<string>): ClientContext {
    return this.attributeValues(key, values);
  }

  attributeValues(key: string, values: Array<string>): ClientContext {
    this._attributes.set(key, values);
    return this;
  }

  clear(): ClientContext {
    this._attributes.clear();
    return this;
  }

  getAttr(key: string, defaultValue?: string): string | undefined {
    if (this._attributes.has(key)) {
      return this._attributes.get(key)![0];
    }

    return defaultValue;
  }

  getAttrs(key: string): Array<string> {
    if (this._attributes.has(key)) {
      return this._attributes.get(key)!;
    }

    return [];
  }

  defaultPercentageKey(): string | undefined {
    return this._attributes.has("session") ? this.getAttr("session") : this.getAttr("userkey");
  }

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

  logAnalyticsEvent(action: string, other?: Map<string, string>, user?: string): void {
    if (user == null) {
      user = this.getAttr("userkey");
    }
    if (user != null) {
      if (other == null) {
        other = new Map<string, string>();
      }

      other.set("cid", user);
    }

    this._repository.logAnalyticsEvent(action, other);
  }
}

export class ServerEvalFeatureContext extends BaseClientContext {
  private readonly _edgeServiceSupplier: EdgeServiceSupplier;
  private _currentEdge: EdgeService | undefined;
  private _config?: FeatureHubConfig;
  private _xHeader: string | undefined;
  private _clientCount = 0;

  constructor(
    repository: InternalFeatureRepository,
    edgeServiceSupplier: EdgeServiceSupplier,
    config?: FeatureHubConfig,
  ) {
    super(repository);

    this._edgeServiceSupplier = edgeServiceSupplier;
    this._config = config;
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
      const newHeader = Array.from(this._attributes.entries())
        .map((key) => key[0] + "=" + encodeURIComponent(key[1].join(",")))
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
  private readonly _edgeService: EdgeService;

  constructor(repository: InternalFeatureRepository, edgeService: EdgeService) {
    super(repository);

    this._edgeService = edgeService;
  }

  async build(): Promise<ClientContext> {
    this._edgeService
      .poll()
      ?.then(() => {})
      .catch(() => {}); // in case it hasn't already been initialized

    return this;
  }

  close(): void {
    this._edgeService.close();
  }

  edgeService(): EdgeService {
    return this._edgeService;
  }

  feature(name: string): FeatureStateHolder {
    return this._repository.feature(name).withContext(this);
  }
}

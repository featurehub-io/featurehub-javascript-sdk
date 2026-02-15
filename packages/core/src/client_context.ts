import type { FeatureStateHolder } from "./feature_state";
import type { FeatureHubRepository } from "./featurehub_repository";
import {
  FeatureValueType,
  StrategyAttributeCountryName,
  StrategyAttributeDeviceName,
  StrategyAttributePlatformName,
} from "./models";
import type {UsageEvent} from "./usage/usage";

export type ContextAttribute = number|string|boolean|Array<number>|Array<string>|Array<boolean>;
export type ContextRecord = Record<string, ContextAttribute>;

export function caToString(ca: ContextAttribute, joinSep = ','): string {
  if (Array.isArray(ca)) {
    return (ca as Array<any>).map(c => c.toString()).join(joinSep);
  }

  return ca.toString();
}

export interface ClientContext {
  userKey(value: string): ClientContext;
  sessionKey(value: string): ClientContext;
  country(value: StrategyAttributeCountryName): ClientContext;
  device(value: StrategyAttributeDeviceName): ClientContext;
  platform(value: StrategyAttributePlatformName): ClientContext;
  version(version: string): ClientContext;

  attributeValue(key: string, value: ContextAttribute): ClientContext;

  clear(): ClientContext;
  build(): Promise<ClientContext>;

  get attributes(): ContextRecord;
  set attributes(data: ContextRecord);

  getAttr(key: string, defaultValue?: ContextAttribute): ContextAttribute | undefined;

  getNumber(name: string): number | undefined;
  getString(name: string): string | undefined;
  getJson(name: string): any | undefined;
  getRawJson(name: string): string | undefined;
  getFlag(name: string): boolean | undefined;
  getBoolean(name: string): boolean | undefined;

  defaultPercentageKey(): string | undefined;

  feature<T = any>(name: string): FeatureStateHolder<T>;
  isEnabled(name: string): boolean;
  isSet(name: string): boolean;
  repository(): FeatureHubRepository;

  used(key: string, id: string, value: string|number|boolean|undefined, valueType: FeatureValueType): void;

  /**
   * If you give it an event, it will pass it through the usage plugins and attempt to fill it in with details
   * along the way. There are some useful classes BaseUsageEvent, UsageEventWithFeature, UsageFeaturesCollection,
   * and UsageFeaturesCollectionContext that we recommend you use as base classes, as they will have their fields
   * detected and filled in.
   *
   * @param event - something that can have "toMap()" called on it
   */
  recordUsageEvent(event: any|UsageEvent): any;

  /**
   * This gives a full
   */
  getContextUsage(): UsageEvent;

  recordNamedUsage(name: string, additionalParams?: Record<string, any>): void;

  close(): void;
}
export interface ConfigChangedListener {
  (config: ClientContext): void;
}

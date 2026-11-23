import { EvaluatedFeature } from "./evaluated_feature";
import type { FeatureStateHolder } from "./feature_state";
import type { FeatureHubRepository } from "./featurehub_repository";
import {
  StrategyAttributeCountryName,
  StrategyAttributeDeviceName,
  StrategyAttributePlatformName,
} from "./models";
import type { UsageEvent } from "./usage/usage";

export type ContextAttribute =
  | number
  | string
  | boolean
  | Date
  | Array<number>
  | Array<string>
  | Array<boolean>
  | Array<Date>
  | undefined;
export type ContextRecord = Record<string, ContextAttribute>;

/**
 * A single context value as a string: a date-time is UTC ISO-8601 (featurehub-protocol.yaml
 * encoding.evaluation_context.wire_value), so it reads the same in every SDK. An invalid Date is undefined.
 */
export function contextValueToString(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? undefined : value.toISOString();
  }

  return String(value);
}

export function caToString(ca: ContextAttribute, joinSep = ","): string | undefined {
  if (ca === undefined) {
    return undefined;
  }
  if (Array.isArray(ca)) {
    return (ca as Array<unknown>)
      .map((c) => contextValueToString(c))
      .filter((c) => c !== undefined)
      .join(joinSep);
  }

  return contextValueToString(ca);
}

export interface ClientContext {
  userKey(value: string | undefined): ClientContext;
  sessionKey(value: string | undefined): ClientContext;
  country(value: StrategyAttributeCountryName | undefined): ClientContext;
  device(value: StrategyAttributeDeviceName | undefined): ClientContext;
  platform(value: StrategyAttributePlatformName | undefined): ClientContext;
  version(version: string | undefined): ClientContext;

  attributeValue(key: string, value: ContextAttribute): ClientContext;

  clear(): ClientContext;
  build(): Promise<ClientContext>;

  get attributes(): ContextRecord;
  // add new attributes
  set attributes(data: ContextRecord);

  getAttr(key: string, defaultValue?: ContextAttribute): ContextAttribute;

  getNumber(name: string): number | undefined;
  getString(name: string): string | undefined;
  getJson(name: string): any | undefined;
  getRawJson(name: string): string | undefined;
  getFlag(name: string): boolean | undefined;
  getBoolean(name: string): boolean | undefined;

  defaultPercentageKey(): string | undefined;

  feature(name: string): FeatureStateHolder;
  isEnabled(name: string): boolean;
  isSet(name: string): boolean;
  repository(): FeatureHubRepository;

  used(value: EvaluatedFeature): void;

  /**
   * If you give it an event, it will pass it through the usage plugins and attempt to fill it in with details
   * along the way. There are some useful classes BaseUsageEvent, BaseUsageEventWithFeature, BaseUsageFeaturesCollection,
   * and BaseUsageFeaturesCollectionContext that we recommend you use as base classes, as they will have their fields
   * detected and filled in.
   *
   * @param event - something that can have "toMap()" called on it
   */
  recordUsageEvent(event: UsageEvent): void;

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

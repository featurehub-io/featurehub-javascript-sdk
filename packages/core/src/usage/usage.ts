import type { ContextRecord } from "../client_context";
import type { FeatureStateHolder } from "../feature_state";
import { FeatureValueType } from "../models";

export interface UsageEvent {
  userKey: string | undefined;
  collectUsageRecord(): Readonly<Record<string, any>>;
}

export class BaseUsageEvent implements UsageEvent {
  public userKey: string | undefined;
  // these are for storing any additional information you want to include along the way
  _userAddedData = {} as Record<string, any>;

  constructor(userKey?: string, additionalParams?: Record<string, any>) {
    this.userKey = userKey;

    if (additionalParams) {
      this._userAddedData = additionalParams;
    }
  }

  public set userAddedData(additionalParams: Record<string, any>) {
    this._userAddedData = additionalParams;
  }

  public collectUsageRecord(): Readonly<Record<string, any>> {
    return Object.assign({}, this._userAddedData);
  }
}

export interface UsageEventName {
  eventName: string;
}

export type UsageConvertFunction = (value: unknown, type: FeatureValueType) => string | undefined;

function convert(value: unknown, type: FeatureValueType): string | undefined {
  if (!value) return undefined;

  switch (type) {
    case FeatureValueType.Boolean:
      return value ? "on" : "off";
    case FeatureValueType.String:
    case FeatureValueType.Number:
      return String(value);
    default:
      return undefined;
  }
}

/**
 * replace this if you want to change the way feature values convert
 */

export let useageConvertFunction: UsageConvertFunction = convert;

/**
 * set or reset the default function that converts feature values to strings for usage data
 * @param ucf
 */
export function setUsageConvertFunction(ucf: UsageConvertFunction | undefined) {
  if (ucf) {
    useageConvertFunction = ucf;
  } else {
    // reset
    useageConvertFunction = convert;
  }
}

export interface FeatureHubUsageValue {
  id: string;
  key: string;
  value: string | undefined;
  rawValue: string | number | boolean | undefined;
  valueType: FeatureValueType;
  environmentId: string;
}

export class UsageValue implements FeatureHubUsageValue {
  id: string;
  key: string;
  value: string | undefined;
  rawValue: string | number | boolean | undefined;
  valueType: FeatureValueType;
  environmentId: string;

  constructor(
    id: string,
    key: string,
    value: string | number | boolean | undefined,
    type: FeatureValueType,
    environmentId: string,
  ) {
    this.id = id;
    this.key = key;
    this.rawValue = value;
    this.valueType = type;
    this.environmentId = environmentId;
    this.value = useageConvertFunction(value, type);
  }

  static fromFeature(feature: FeatureStateHolder): FeatureHubUsageValue {
    return new UsageValue(
      feature.id!,
      feature.key!,
      feature.untrackedValue,
      feature.type!,
      feature.environmentId!,
    );
  }
}

export interface UsageEventWithFeature extends UsageEvent, UsageEventName {
  get attributes(): ContextRecord | undefined;
  get feature(): FeatureHubUsageValue;
}

export function isUsageEventWithFeature(event: UsageEvent): event is UsageEventWithFeature {
  return "feature" in event;
}

export class BaseUsageEventWithFeature extends BaseUsageEvent implements UsageEventWithFeature {
  private _contextAttributes: ContextRecord | undefined;
  private _feature: FeatureHubUsageValue;
  public readonly eventName = "feature";

  constructor(feature: FeatureHubUsageValue, contextAttributes?: ContextRecord, userKey?: string) {
    super(userKey);
    this._contextAttributes = contextAttributes;
    this._feature = feature;
  }

  get attributes(): ContextRecord | undefined {
    return this._contextAttributes;
  }

  get feature(): FeatureHubUsageValue {
    return this._feature;
  }

  public override collectUsageRecord(): Readonly<Record<string, any>> {
    const featureData = {
      feature: this._feature.key,
      value: this._feature.value,
      id: this._feature.id,
      environmentId: this._feature.environmentId,
    };

    return Object.assign(super.collectUsageRecord(), this._contextAttributes || {}, featureData);
  }
}

export interface UsageFeaturesCollection extends UsageEvent, UsageEventName {
  featureValues: Array<FeatureHubUsageValue>;
}

export function isUsageFeaturesCollection(event: UsageEvent): event is UsageFeaturesCollection {
  return "featureValues" in event;
}

export class BaseUsageFeaturesCollection extends BaseUsageEvent implements UsageFeaturesCollection {
  public featureValues = [] as Array<FeatureHubUsageValue>;
  public eventName = "feature-collection";

  override collectUsageRecord(): Readonly<Record<string, any>> {
    const features = {} as Record<string, any | undefined>;

    this.featureValues.forEach((fv) => {
      features[fv.key] = fv.value;
      features[fv.key + "_raw"] = fv.rawValue;
    });

    features["fhub_keys"] = this.featureValues.map((fv) => fv.key);

    return Object.assign(super.collectUsageRecord(), features);
  }
}

export interface UsageFeaturesCollectionContext extends UsageFeaturesCollection {
  contextAttributes: ContextRecord;
}

export function isUsageFeaturesCollectionContext(
  event: UsageEvent,
): event is UsageFeaturesCollectionContext {
  return "featureValues" in event && "contextAttributes" in event;
}

export class BaseUsageFeaturesCollectionContext
  extends BaseUsageFeaturesCollection
  implements UsageFeaturesCollectionContext
{
  public contextAttributes = {} as ContextRecord;

  constructor(userKey?: string, additionalParams?: Record<string, any>) {
    super(userKey, additionalParams);
    this.eventName = "feature-collection-context";
  }

  override collectUsageRecord(): Readonly<Record<string, any>> {
    return Object.assign(super.collectUsageRecord(), this.contextAttributes);
  }
}

export interface UsageNamedFeaturesCollection extends UsageFeaturesCollectionContext {
  eventName: string;
}

export function isUsageNamedFeaturesCollection(
  event: UsageEvent,
): event is UsageNamedFeaturesCollection {
  return "featureValues" in event && "contextAttributes" in event && "eventName" in event;
}

export class BaseUsageNamedFeaturesCollection
  extends BaseUsageFeaturesCollectionContext
  implements UsageNamedFeaturesCollection
{
  public override eventName: string;

  constructor(name: string, userKey?: string, additionalParams?: Record<string, any>) {
    super(userKey, additionalParams);
    this.eventName = name;
  }
}

export interface UsagePlugin {
  get defaultPluginAttributes(): Record<string, any>;
  canSendAsync: boolean;
  send(event: UsageEvent): void;
  close?(): void;
}

export abstract class DefaultUsagePlugin implements UsagePlugin {
  protected readonly _defaultPluginAttributes = {} as Record<string, any>;
  public canSendAsync = true;

  public get defaultPluginAttributes(): Record<string, any> {
    return this._defaultPluginAttributes;
  }

  public abstract send(event: UsageEvent): void;

  public close(): void {}
}

export interface UsageEventListener {
  (event: UsageEvent): void;
}

export interface UsageProvider {
  createFeatureHubUsageValue(feature: FeatureStateHolder): FeatureHubUsageValue;

  createFeatureHubUsageValueFromFields(
    id: string,
    key: string,
    value: string | number | boolean | undefined,
    type: FeatureValueType,
    environmentId: string,
  ): FeatureHubUsageValue;

  createUsageFeature(
    feature: FeatureHubUsageValue,
    contextAttributes?: ContextRecord | undefined,
    userKey?: string,
  ): UsageEventWithFeature;

  createUsageCollectionEvent(): UsageFeaturesCollection;

  createUsageContextCollectionEvent(): UsageFeaturesCollectionContext;

  createNamedUsageCollection(
    name: string,
    additionalParams?: Record<string, any>,
  ): UsageNamedFeaturesCollection;
}

export class DefaultUsageProvider implements UsageProvider {
  public createFeatureHubUsageValue(feature: FeatureStateHolder): FeatureHubUsageValue {
    return UsageValue.fromFeature(feature);
  }

  public createFeatureHubUsageValueFromFields(
    id: string,
    key: string,
    value: string | number | boolean | undefined,
    type: FeatureValueType,
    environmentId: string,
  ): FeatureHubUsageValue {
    return new UsageValue(id, key, value, type, environmentId);
  }

  public createUsageFeature(
    feature: FeatureHubUsageValue,
    contextAttributes?: ContextRecord | undefined,
    userKey?: string,
  ): UsageEventWithFeature {
    return new BaseUsageEventWithFeature(feature, contextAttributes, userKey);
  }

  public createUsageCollectionEvent(): UsageFeaturesCollection {
    return new BaseUsageFeaturesCollection();
  }

  public createUsageContextCollectionEvent(): UsageFeaturesCollectionContext {
    return new BaseUsageFeaturesCollectionContext();
  }

  public createNamedUsageCollection(
    name: string,
    additionalParams?: Record<string, any>,
  ): UsageNamedFeaturesCollection {
    return new BaseUsageNamedFeaturesCollection(name, undefined, additionalParams);
  }
}

// replace this globally with your own if you want to.
export const defaultUsageProvider = new DefaultUsageProvider();

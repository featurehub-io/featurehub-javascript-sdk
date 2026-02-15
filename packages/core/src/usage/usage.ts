import type {ContextRecord} from "../client_context";
import type {FeatureStateHolder} from "../feature_state";
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

export type UsageConvertFunction = (value: any | undefined, type: FeatureValueType) => any | undefined;

function convert(value: any | undefined, type: FeatureValueType): any | undefined {
  if (!value) return undefined;

  switch (type) {
    case FeatureValueType.Boolean:
      return value ? "on" : "off";
    case FeatureValueType.String:
    case FeatureValueType.Number:
      return value.toString();
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
export function setUsageConvertFunction(ucf: UsageConvertFunction|undefined) {
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
  value: any|undefined;
}

export class UsageValue implements FeatureHubUsageValue {
  id: string;
  key: string;
  value: string | number | boolean | undefined;

  constructor(id: string, key: string, value: any | undefined, type: FeatureValueType) {
    this.id = id;
    this.key = key;
    this.value = useageConvertFunction(value, type);
  }

  static fromFeature(feature: FeatureStateHolder): FeatureHubUsageValue {
    return new UsageValue(feature.id!, feature.key!, feature.untrackedValue, feature.type!);
  }
}

export class UsageEventWithFeature extends BaseUsageEvent implements UsageEventName {
  private _contextAttributes: ContextRecord | undefined;
  private _feature: FeatureHubUsageValue;
  public readonly eventName = "feature";

  constructor(
    feature: FeatureHubUsageValue,
    contextAttributes?: ContextRecord,
    userKey?: string
  ) {
    super(userKey);
    this._contextAttributes = contextAttributes;
    this._feature = feature;
  }

  get attributes(): ContextRecord| undefined {
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
    };

    return Object.assign(super.collectUsageRecord(), this._contextAttributes || {}, featureData);
  }
}

export class UsageFeaturesCollection extends BaseUsageEvent implements UsageEventName {
  public featureValues = [] as Array<FeatureHubUsageValue>;
  public eventName = "feature-collection";

  override collectUsageRecord(): Readonly<Record<string, any>> {
    const features = {} as Record<string, any | undefined>;
    this.featureValues.forEach((fv) => (
      features[fv.key] = fv.value));
    return Object.assign(super.collectUsageRecord(), features);
  }
}

export class UsageFeaturesCollectionContext
  extends UsageFeaturesCollection
  implements UsageEventName
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

export class UsageNamedFeaturesCollection extends UsageFeaturesCollectionContext {
  constructor(name: string, userKey?: string, additionalParams?: Record<string, any>) {
    super(userKey, additionalParams);
    this.eventName = name;
  }
}

export abstract class UsagePlugin {
  protected readonly _defaultPluginAttributes = {} as Record<string, any>;

  public get defaultPluginAttributes(): Record<string, any> {
    return this._defaultPluginAttributes;
  }

  public abstract send(event: UsageEvent): void;
}

export interface UsageEventListener {
  (event: UsageEvent): void;
}

export class UsageProvider {
  public createFeatureHubUsageValue(feature: FeatureStateHolder) : FeatureHubUsageValue {
    return UsageValue.fromFeature(feature);
  }

  public createFeatureHubUsageValueFromFields(id: string, key: string,
        value: string | number | boolean | undefined, type: FeatureValueType)  : FeatureHubUsageValue {
    return new UsageValue(id, key, value, type);
  }

  public createUsageFeature(
    feature: FeatureHubUsageValue,
    contextAttributes?: ContextRecord|undefined,
    userKey?: string,
  ) {
    return new UsageEventWithFeature(feature, contextAttributes, userKey);
  }

  public createUsageCollectionEvent() {
    return new UsageFeaturesCollection();
  }

  public createUsageContextCollectionEvent() {
    return new UsageFeaturesCollectionContext();
  }

  public createNamedUsageCollection(name: string, additionalParams?: Record<string, any>) {
    return new UsageNamedFeaturesCollection(name, undefined, additionalParams);
  }
}

// replace this globally with your own if you want to.
export const defaultUsageProvider = new UsageProvider();

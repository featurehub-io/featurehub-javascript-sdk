import type { FeatureValue } from "./feature_state";
import type { FeatureState } from "./models/models/feature-state";

// Overload signatures enforce compile-time constraints on which combinations are valid.
// (featureState, value, strategyId) — featureState must not be undefined
// (featureState, value) — featureState may be undefined
// (value) — featureState and strategyId are both undefined
// (featureState) — featureState must not be undefined; value comes from featureState.value

export class EvaluatedFeature {
  private readonly _value: FeatureValue;
  private readonly _strategyId: string | undefined;
  private readonly _featureState: FeatureState | undefined;

  private constructor(
    value: FeatureValue,
    featureState: FeatureState | undefined,
    strategyId: string | undefined,
  ) {
    this._value = value;
    this._featureState = featureState;
    this._strategyId = strategyId;
  }

  static create(
    featureState: FeatureState,
    value: FeatureValue,
    strategyId: string,
  ): EvaluatedFeature;
  static create(featureState: FeatureState | undefined, value: FeatureValue): EvaluatedFeature;
  static create(featureStateOrValue: FeatureValue | FeatureState): EvaluatedFeature;
  static create(
    featureStateOrValue: FeatureState | FeatureValue,
    value?: FeatureValue,
    strategyId?: string,
  ): EvaluatedFeature {
    // (featureState, value, strategyId) or (featureState, value)
    if (value !== undefined || arguments.length === 2) {
      return new EvaluatedFeature(
        value as FeatureValue,
        featureStateOrValue as FeatureState | undefined,
        strategyId,
      );
    }

    // Single-argument: FeatureState object (has a `key` property) vs plain FeatureValue
    if (
      featureStateOrValue !== null &&
      typeof featureStateOrValue === "object" &&
      !Array.isArray(featureStateOrValue) &&
      "key" in featureStateOrValue
    ) {
      const fs = featureStateOrValue as FeatureState;
      return new EvaluatedFeature(fs.value as FeatureValue, fs, undefined);
    }

    // Single-argument: bare FeatureValue value
    return new EvaluatedFeature(featureStateOrValue as FeatureValue, undefined, undefined);
  }

  get value(): FeatureValue {
    return this._value;
  }

  get strategyId(): string | undefined {
    return this._strategyId;
  }

  get featureState(): FeatureState | undefined {
    return this._featureState;
  }

  hasValue(): boolean {
    return this._value !== undefined;
  }

  toString(): string {
    return [this._value?.toString(), this.strategyId, this._featureState?.key]
      .filter((s) => s !== undefined)
      .join(",");
  }
}

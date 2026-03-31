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

  static withValue(value: FeatureValue): EvaluatedFeature {
    return new EvaluatedFeature(value, undefined, undefined);
  }

  static withFeatureState(featureState: FeatureState): EvaluatedFeature {
    return new EvaluatedFeature(featureState.value as FeatureValue, featureState, undefined);
  }

  static withFeatureStateAndValue(
    featureState: FeatureState | undefined,
    value: FeatureValue,
  ): EvaluatedFeature {
    return new EvaluatedFeature(value, featureState, undefined);
  }

  static withFeatureStateValueAndStrategy(
    featureState: FeatureState,
    value: FeatureValue,
    strategyId: string,
  ): EvaluatedFeature {
    return new EvaluatedFeature(value, featureState, strategyId);
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

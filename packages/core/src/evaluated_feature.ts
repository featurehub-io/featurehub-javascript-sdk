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
  private readonly _split: boolean;

  private constructor(
    value: FeatureValue,
    featureState: FeatureState | undefined,
    strategyId: string | undefined,
    split = false,
  ) {
    this._value = value;
    this._featureState = featureState;
    this._strategyId = strategyId;
    this._split = split;
  }

  static withValue(value: FeatureValue): EvaluatedFeature {
    return new EvaluatedFeature(value, undefined, undefined);
  }

  /**
   * The feature's own value, with the id of the strategy the server applied (`v`, for a server-evaluated or
   * snapshot-evaluated feature), if any (openfeature-resolution.yaml evaluation.steps.no_strategies).
   */
  static withFeatureState(featureState: FeatureState): EvaluatedFeature {
    return new EvaluatedFeature(
      featureState.value as FeatureValue,
      featureState,
      featureState.v ?? undefined,
    );
  }

  static withFeatureStateAndValue(
    featureState: FeatureState | undefined,
    value: FeatureValue,
  ): EvaluatedFeature {
    return new EvaluatedFeature(value, featureState, undefined);
  }

  /** a strategy matched locally; split if it is a percentage rollout */
  static withFeatureStateValueAndStrategy(
    featureState: FeatureState,
    value: FeatureValue,
    strategyId: string,
    split = false,
  ): EvaluatedFeature {
    return new EvaluatedFeature(value, featureState, strategyId, split);
  }

  get value(): FeatureValue {
    return this._value;
  }

  get strategyId(): string | undefined {
    return this._strategyId;
  }

  /**
   * The value came from a percentage rollout matched locally (an OpenFeature SPLIT). A strategy the server
   * applied (`v`) is never a split, as its percentage is not sent.
   */
  get split(): boolean {
    return this._split;
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

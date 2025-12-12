import { beforeEach, describe, expect, it } from "vitest";

import { FeatureStateBaseHolder } from "../feature_state_holders";
import {
  type AnalyticsCollector,
  BaseClientContext,
  type ClientContext,
  type FeatureRolloutStrategy,
  type FeatureRolloutStrategyAttribute,
  type FeatureState,
  type FeatureStateHolder,
  type FeatureStateValueInterceptor,
  FeatureValueType,
  InterceptorValueMatch,
  type InternalFeatureRepository,
  type PostLoadNewFeatureStateAvailableListener,
  Readyness,
  type ReadynessListener,
  RolloutStrategyAttributeConditional,
  RolloutStrategyFieldType,
  SSEResultState,
} from "../index";
import { Applied, ApplyFeature } from "../strategy_matcher";

class TestingContext extends BaseClientContext {
  build(): Promise<ClientContext> {
    throw new Error("Method not implemented.");
  }

  feature(_name: string): FeatureStateHolder<any> {
    throw new Error("Method not implemented.");
  }

  close(): void {
    throw new Error("Method not implemented.");
  }

  // eslint-disable-next-line @typescript-eslint/no-useless-constructor
  constructor(repository: InternalFeatureRepository) {
    super(repository);
  }
}

class FakeInternalRepository implements InternalFeatureRepository {
  private applier = new ApplyFeature();

  notReady(): void {
    throw new Error("Method not implemented.");
  }

  notify(_state: SSEResultState, _data: any) {
    throw new Error("Method not implemented.");
  }

  valueInterceptorMatched(_key: string): InterceptorValueMatch {
    return new InterceptorValueMatch(undefined);
  }

  apply(
    strategies: FeatureRolloutStrategy[],
    key: string,
    featureValueId: string,
    context: ClientContext,
  ): Applied {
    return this.applier.apply(strategies, key, featureValueId, context);
  }

  readyness: Readyness = Readyness.Ready;
  catchAndReleaseMode = false;

  logAnalyticsEvent(_action: string, _other?: Map<string, string>, _ctx?: ClientContext) {
    throw new Error("Method not implemented.");
  }

  hasFeature(_key: string): FeatureStateHolder<any> {
    throw new Error("Method not implemented.");
  }

  feature(_key: string): FeatureStateHolder<any> {
    throw new Error("Method not implemented.");
  }

  getFeatureState<T = any>(_key: string): FeatureStateHolder<T> {
    throw new Error("Method not implemented.");
  }

  release(_disableCatchAndRelease?: boolean): Promise<void> {
    throw new Error("Method not implemented.");
  }

  simpleFeatures(): Map<string, string> {
    throw new Error("Method not implemented.");
  }

  getFlag(_key: string): boolean {
    throw new Error("Method not implemented.");
  }

  getString(_key: string): string {
    throw new Error("Method not implemented.");
  }

  getJson(_key: string): string {
    throw new Error("Method not implemented.");
  }

  getNumber(_key: string): number {
    throw new Error("Method not implemented.");
  }

  isSet(_key: string): boolean {
    throw new Error("Method not implemented.");
  }

  addValueInterceptor(_interceptor: FeatureStateValueInterceptor): void {
    throw new Error("Method not implemented.");
  }

  addReadynessListener(_listener: ReadynessListener): number {
    throw new Error("Method not implemented.");
  }

  addReadinessListener(_listener: ReadynessListener, _ignoreNotReadyOnRegister?: boolean): number {
    throw new Error("Method not implemented.");
  }

  removeReadinessListener(_listener: number | ReadynessListener) {
    throw new Error("Method not implemented.");
  }

  addAnalyticCollector(_collector: AnalyticsCollector): void {
    throw new Error("Method not implemented.");
  }

  addPostLoadNewFeatureStateAvailableListener(
    _listener: PostLoadNewFeatureStateAvailableListener,
  ): number {
    throw new Error("Method not implemented.");
  }

  removePostLoadNewFeatureStateAvailableListener(
    _listener: number | PostLoadNewFeatureStateAvailableListener,
  ) {
    throw new Error("Method not implemented.");
  }
}

describe("When checking for listeners triggering on strategy changes", () => {
  let repo: FakeInternalRepository;

  beforeEach(() => {
    repo = new FakeInternalRepository();
  });

  it("should ripple listener changes down", () => {
    const key = "feature-value";
    const f1 = new FeatureStateBaseHolder(repo, key);
    const ctx = new TestingContext(repo).attributeValue("testing", "x");

    let listener1Result: any = undefined;
    let listener2Result: any = undefined;
    let listener1TriggerCounter = 0;
    let listener2TriggerCounter = 0;

    f1.addListener((ft1) => {
      listener1Result = ft1;
      listener1TriggerCounter++;
    });

    f1.withContext(ctx).addListener((ft1) => {
      listener2Result = ft1;
      listener2TriggerCounter++;
    });

    const feature1 = {
      id: "1",
      key: key,
      l: false,
      version: 1,
      type: FeatureValueType.Boolean,
      value: false,
      strategies: [
        {
          id: "abcd",
          value: true,
          attributes: [
            {
              conditional: RolloutStrategyAttributeConditional.Equals,
              fieldName: "testing",
              type: RolloutStrategyFieldType.String,
              values: ["x"],
            } as FeatureRolloutStrategyAttribute,
          ],
        } as FeatureRolloutStrategy,
      ],
    } as FeatureState;

    f1.setFeatureState(feature1);

    expect(listener1Result).toBeDefined();
    expect(listener2Result).toBeDefined();
    const l1Result = listener1Result as FeatureStateHolder<boolean>;
    const l2Result = listener2Result as FeatureStateHolder<boolean>;
    expect(l1Result?.flag).toBe(false);
    expect(l2Result?.flag).toBe(true);
    expect(listener2TriggerCounter).toBe(1);
    expect(listener1TriggerCounter).toBe(1);

    const featureV2 = {
      id: "1",
      key: key,
      l: false,
      version: 2,
      type: FeatureValueType.Boolean,
      value: false,
      strategies: [
        {
          id: "abcd",
          value: false,
          attributes: [
            {
              conditional: RolloutStrategyAttributeConditional.Equals,
              fieldName: "testing",
              type: RolloutStrategyFieldType.String,
              values: ["y"],
            } as FeatureRolloutStrategyAttribute,
          ],
        } as FeatureRolloutStrategy,
      ],
    } as FeatureState;

    f1.setFeatureState(featureV2);
    expect(listener2TriggerCounter).toBe(2); // this should trigger again as the strategy changed
    expect(listener1TriggerCounter).toBe(1);
    expect(listener2Result.flag).toBe(false);
  });
});

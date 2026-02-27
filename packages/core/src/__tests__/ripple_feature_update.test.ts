import { beforeEach, describe, expect, it } from "vitest";

import { FeatureStateBaseHolder } from "../feature_state_holders";
import {
  type FeatureRolloutStrategy,
  type FeatureRolloutStrategyAttribute,
  type FeatureState,
  type FeatureStateHolder,
  FeatureValueType,
  RolloutStrategyAttributeConditional,
  RolloutStrategyFieldType,
} from "../index";
import { FakeInternalRepository, TestingContext } from "./testing_context";

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

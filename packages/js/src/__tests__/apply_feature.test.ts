import { Arg, Substitute, type SubstituteOf } from "@fluffy-spoon/substitute";
import { beforeEach, describe, expect, it } from "vitest";

import type { ClientContext } from "../client_context";
import {
  type FeatureRolloutStrategy,
  type FeatureRolloutStrategyAttribute,
  RolloutStrategyAttributeConditional,
  RolloutStrategyFieldType,
} from "../models";
import {
  ApplyFeature,
  MatcherRegistry,
  type MatcherRepository,
  type PercentageCalculator,
  type StrategyMatcher,
} from "../strategy_matcher";

describe("apply feature works as expected", () => {
  let pCalc: SubstituteOf<PercentageCalculator>;
  let matcher: SubstituteOf<MatcherRepository>;
  let app: ApplyFeature;
  let ctx: SubstituteOf<ClientContext>;

  beforeEach(() => {
    pCalc = Substitute.for<PercentageCalculator>();
    matcher = Substitute.for<MatcherRepository>();
    ctx = Substitute.for<ClientContext>();

    app = new ApplyFeature(pCalc, matcher);
  });

  it("should always return false when there is an undefined context", () => {
    const found = app.apply([{} as FeatureRolloutStrategy], "key", "fid", ctx);

    expect(found.matched).toBe(false);
    expect(found.value).toBeNull();
  });

  it("should be false when the rollout strategies are empty", () => {
    const found = app.apply([], "key", "fid", ctx);

    expect(found.matched).toBe(false);
    expect(found.value).toBeNull();
  });

  it("should be false when the rollout strategies are null", () => {
    const found = app.apply(undefined, "key", "fid", ctx);

    expect(found.matched).toBe(false);
    expect(found.value).toBeNull();
  });

  it("should be false if none of the rollout strategies match the context", () => {
    ctx.defaultPercentageKey().returns("userkey");
    ctx.getAttrs("warehouseId").returns([]);
    const found = app.apply(
      [
        {
          attributes: [
            {
              fieldName: "warehouseId",
              conditional: RolloutStrategyAttributeConditional.Includes,
              values: ["ponsonby"],
              type: RolloutStrategyFieldType.String,
            } as FeatureRolloutStrategyAttribute,
          ],
        } as FeatureRolloutStrategy,
      ],
      "FEATURE_NAME",
      "fid",
      ctx,
    );
    expect(found.matched).toBe(false);
    expect(found.value).toBeNull();
  });

  it("should not match the percentage but should match the field comparison", () => {
    ctx.defaultPercentageKey().returns("userkey");
    ctx.getAttrs("warehouseId").returns(["ponsonby"]);
    const found = app.apply(
      [
        {
          value: "sausage",
          attributes: [
            {
              fieldName: "warehouseId",
              conditional: RolloutStrategyAttributeConditional.Includes,
              values: ["ponsonby"],
              type: RolloutStrategyFieldType.String,
            } as FeatureRolloutStrategyAttribute,
          ],
        } as FeatureRolloutStrategy,
      ],
      "FEATURE_NAME",
      "fid",
      ctx,
    );

    expect(found.matched).toBe(true);
    expect(found.value).toBe("sausage");
  });

  it("should not match the field comparison if the value is different", () => {
    ctx.defaultPercentageKey().returns("userkey");
    ctx.getAttrs("warehouseId").returns(["ponsonby"]);

    const sMatcher = Substitute.for<StrategyMatcher>();
    sMatcher.match("ponsonby", Arg.any()).returns(false);

    matcher.findMatcher(Arg.any()).returns(sMatcher);

    const found = app.apply(
      [
        {
          id: "x",
          value: "sausage",
          attributes: [
            {
              fieldName: "warehouseId",
              conditional: RolloutStrategyAttributeConditional.Includes,
              values: ["ponsonby"],
              type: RolloutStrategyFieldType.String,
            },
          ],
        },
      ],
      "FEATURE_NAME",
      "fid",
      ctx,
    );

    expect(found.matched).toBe(false);
    expect(found.value).toBeNull();
  });

  it("should extract the values out of the context when determining the value for percentage", () => {
    ctx.defaultPercentageKey().returns("user@email");

    expect(ApplyFeature.determinePercentageKey(ctx, [])).toBe("user@email");

    ctx.getAttr("a", Arg.any()).returns("one-thing");
    ctx.getAttr("b", Arg.any()).returns("two-thing");

    expect(ApplyFeature.determinePercentageKey(ctx, ["a", "b"])).toBe("one-thing$two-thing");
  });

  it("should process basic percentages properly", () => {
    ctx.defaultPercentageKey().returns("userkey");
    pCalc.determineClientPercentage("userkey", "fid").returns(15);

    const sApp = new ApplyFeature(pCalc, new MatcherRegistry());

    const found = sApp.apply(
      [
        {
          value: "sausage",
          percentage: 20,
        } as FeatureRolloutStrategy,
      ],
      "FEATURE_NAME",
      "fid",
      ctx,
    );

    expect(found.matched).toBe(true);
    expect(found.value).toBe("sausage");
  });

  it("should bounce bad percentages properly", () => {
    ctx.defaultPercentageKey().returns("userkey");
    pCalc.determineClientPercentage("userkey", "fid").returns(21);

    const sApp = new ApplyFeature(pCalc, new MatcherRegistry());

    const found = sApp.apply(
      [
        {
          value: "sausage",
          percentage: 20,
        } as FeatureRolloutStrategy,
      ],
      "FEATURE_NAME",
      "fid",
      ctx,
    );

    expect(found.matched).toBe(false);
  });

  it("should process pattern match percentages properly", () => {
    ctx.defaultPercentageKey().returns("userkey");
    ctx.getAttrs("warehouseId").returns(["ponsonby"]);
    pCalc.determineClientPercentage("userkey", "fid").returns(15);

    const sApp = new ApplyFeature(pCalc, new MatcherRegistry());

    const found = sApp.apply(
      [
        {
          id: "x",
          value: "sausage",
          percentage: 20,
          attributes: [
            {
              fieldName: "warehouseId",
              conditional: RolloutStrategyAttributeConditional.Includes,
              values: ["ponsonby"],
              type: RolloutStrategyFieldType.String,
            },
          ],
        },
      ],
      "FEATURE_NAME",
      "fid",
      ctx,
    );

    expect(found.matched).toBe(true);
    expect(found.value).toBe("sausage");
  });

  it("should fail pattern match percentages properly", () => {
    ctx.defaultPercentageKey().returns("userkey");
    ctx.getAttrs("warehouseId").returns([]);
    pCalc.determineClientPercentage("userkey", "fid").returns(15);

    const sApp = new ApplyFeature(pCalc, new MatcherRegistry());

    const found = sApp.apply(
      [
        {
          id: "x",
          value: "sausage",
          percentage: 20,
          attributes: [
            {
              fieldName: "warehouseId",
              conditional: RolloutStrategyAttributeConditional.Includes,
              values: ["ponsonby"],
              type: RolloutStrategyFieldType.String,
            },
          ],
        },
      ],
      "FEATURE_NAME",
      "fid",
      ctx,
    );

    expect(found.matched).toBe(false);
  });
});

import { describe, expect, it } from "vitest";

import type { ClientContext, ContextAttribute } from "../client_context";
import {
  type FeatureRolloutStrategy,
  RolloutStrategyAttributeConditional as C,
  RolloutStrategyFieldType as T,
} from "../models";
import { ApplyFeature } from "../strategy_matcher";

function context(attrs: Record<string, ContextAttribute>, percentageKey?: string): ClientContext {
  return {
    getAttr: (key: string) => attrs[key],
    defaultPercentageKey: () => percentageKey,
  } as unknown as ClientContext;
}

const country = (values: Array<string> | null) => ({
  fieldName: "country",
  type: T.String,
  conditional: C.Equals,
  values,
});

// featurehub-protocol.yaml conformance nullable-strategy-fields: null and absent mean the same as empty
describe("strategies with null fields", () => {
  const apply = (strategy: unknown, ctx: ClientContext) =>
    new ApplyFeature().apply([strategy as FeatureRolloutStrategy], "ling", "fv1", ctx);

  it("matches on attributes when the percentage is null", () => {
    const strategy = { id: "s1", value: true, percentage: null, attributes: [country(["th"])] };

    expect(apply(strategy, context({ country: "th" }, "lingling")).matched).toBe(true);
    expect(apply(strategy, context({ country: "nz" }, "lingling")).matched).toBe(false);
  });

  it("is a pure percentage strategy when the attributes are null, rather than throwing", () => {
    const strategy = { id: "s1", value: true, percentage: 1000000, attributes: null };

    expect(apply(strategy, context({}, "orm")).matched).toBe(true);
  });

  it("uses the default percentage key when percentageAttributes is null", () => {
    const strategy = { id: "s1", value: true, percentage: 1000000, percentageAttributes: null };

    expect(apply(strategy, context({}, "kornaphat")).matched).toBe(true);
  });

  it("does not match an attribute whose values are null", () => {
    const strategy = { id: "s1", value: true, attributes: [country(null)] };

    expect(apply(strategy, context({ country: "th" }, "sirilak")).matched).toBe(false);
  });

  it("treats null and absent the same", () => {
    const withNull = { id: "s1", value: true, percentage: null, attributes: [country(["th"])] };
    const absent = { id: "s1", value: true, attributes: [country(["th"])] };
    const ctx = context({ country: "th" }, "lingling");

    expect(apply(withNull, ctx)).toEqual(apply(absent, ctx));
  });
});

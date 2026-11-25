import { afterEach, describe, expect, it } from "vitest";

import type { ClientContext, ContextAttribute } from "../client_context";
import { xFeatureHubHeader } from "../context_header";
import {
  type FeatureRolloutStrategy,
  type FeatureRolloutStrategyAttribute,
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

const when = (
  conditional: C,
  values: Array<string> | null,
  type: T = T.Datetime,
  fieldName = "fhubWhenActive",
): FeatureRolloutStrategyAttribute =>
  ({ fieldName, type, conditional, values }) as FeatureRolloutStrategyAttribute;

// ApplyFeature.clock is in whole seconds since the epoch
const at = (iso: string) => () => Math.floor(Date.parse(iso) / 1000);

describe("fhubWhenActive", () => {
  const originalClock = ApplyFeature.clock;

  afterEach(() => {
    ApplyFeature.clock = originalClock;
  });

  const matches = (
    attr: FeatureRolloutStrategyAttribute,
    clock: string,
    attrs: Record<string, ContextAttribute> = {},
  ) => {
    ApplyFeature.clock = at(clock);
    return new ApplyFeature().apply(
      [{ id: "s1", value: true, attributes: [attr] } as FeatureRolloutStrategy],
      "lingling",
      "fv1",
      context(attrs),
    ).matched;
  };

  const T9 = "2026-12-01T09:00:00Z";

  // rollout-strategies.yaml algorithm.well_known_attributes.fhubWhenActive.vectors
  it.each([
    [when(C.GreaterEquals, [T9]), "2026-12-01T08:59:59.999Z", false],
    [when(C.GreaterEquals, [T9]), "2026-12-01T09:00:00.000Z", true],
    [when(C.GreaterEquals, [T9]), "2027-01-01T00:00:00Z", true],
    [when(C.GreaterEquals, [T9], T.String), "2026-12-02T00:00:00Z", true],
    [when(C.GreaterEquals, [T9], T.Datetime, "FHUBWHENACTIVE"), "2026-12-02T00:00:00Z", true],
    [when(C.GreaterEquals, []), "2026-12-02T00:00:00Z", false],
    [when(C.GreaterEquals, ["next tuesday"]), "2026-12-02T00:00:00Z", false],
    [when(C.Greater, [T9]), "2026-12-01T09:00:00.000Z", false],
    [when(C.Less, [T9]), "2026-12-01T08:59:59.999Z", true],
    [when(C.Less, [T9]), "2026-12-01T09:00:00.000Z", false],
    [when(C.LessEquals, [T9]), "2026-12-01T09:00:00.000Z", true],
    [when(C.Equals, [T9]), "2026-12-01T09:00:00.000Z", true],
    [when(C.Equals, [T9]), "2026-12-01T09:00:00.999Z", true],
    [when(C.Equals, [T9]), "2026-12-01T09:00:01Z", false],
    [when(C.NotEquals, [T9]), "2026-12-01T09:00:00.500Z", false],
    [when(C.NotEquals, [T9]), "2026-12-01T09:00:01Z", true],
    [when(C.Greater, [T9]), "2026-12-01T09:00:00.999Z", false],
    [when(C.Greater, [T9]), "2026-12-01T09:00:01Z", true],
    [when(C.Equals, ["2026-12-01T09:00:00.750Z"]), "2026-12-01T09:00:00.100Z", true],
    [when(C.Includes, [T9]), "2027-01-01T00:00:00Z", false],
    [when(C.Excludes, [T9]), "2027-01-01T00:00:00Z", false],
    [when(C.NotEquals, []), "2027-01-01T00:00:00Z", false],
    [when(C.Regex, [T9]), "2027-01-01T00:00:00Z", false],
    [when(C.GreaterEquals, null), "2027-01-01T00:00:00Z", false],
  ])("%o at %s matches: %s", (attr, clock, result) => {
    expect(matches(attr, clock)).toBe(result);
  });

  it("never takes the time from the context", () => {
    expect(
      matches(when(C.GreaterEquals, [T9]), "2026-11-30T00:00:00Z", {
        fhubWhenActive: "2020-01-01T00:00:00Z",
      }),
    ).toBe(false);
  });

  it("accepts a value with an offset, as that instant in UTC", () => {
    expect(
      matches(when(C.GreaterEquals, ["2026-12-01T10:00:00+01:00"]), "2026-12-01T09:00:00Z"),
    ).toBe(true);
  });

  it("is worked out from the clock on every evaluation", () => {
    const strategies = [
      { id: "s1", value: true, attributes: [when(C.GreaterEquals, [T9])] },
    ] as FeatureRolloutStrategy[];
    const apply = new ApplyFeature();

    ApplyFeature.clock = at("2026-11-30T00:00:00Z");
    expect(apply.apply(strategies, "orm", "fv1", context({})).matched).toBe(false);

    ApplyFeature.clock = at("2026-12-02T00:00:00Z");
    expect(apply.apply(strategies, "orm", "fv1", context({})).matched).toBe(true);
  });

  // rollout-strategies.yaml algorithm.well_known_attributes.fhubWhenActive.strategy_vectors
  describe("combined with other rules", () => {
    const withCountry = {
      id: "s1",
      value: true,
      attributes: [
        when(C.GreaterEquals, [T9]),
        { fieldName: "country", type: T.String, conditional: C.Equals, values: ["nz"] },
      ],
    } as FeatureRolloutStrategy;
    const withPercentage = {
      id: "s2",
      value: true,
      percentage: 1000000,
      attributes: [when(C.GreaterEquals, [T9])],
    } as FeatureRolloutStrategy;

    it.each([
      [withCountry, "2026-12-02T00:00:00Z", { country: "nz" }, true],
      [withCountry, "2026-12-02T00:00:00Z", { country: "au" }, false],
      [withCountry, "2026-11-30T00:00:00Z", { country: "nz" }, false],
    ])("%#: country rollout at a time", (strategy, clock, attrs, matched) => {
      ApplyFeature.clock = at(clock);
      expect(new ApplyFeature().apply([strategy], "kornaphat", "fv1", context(attrs)).matched).toBe(
        matched,
      );
    });

    it.each([
      ["2026-12-02T00:00:00Z", true],
      ["2026-11-30T00:00:00Z", false],
    ])("a 100%% strategy at %s matches: %s", (clock, matched) => {
      ApplyFeature.clock = at(clock);
      expect(
        new ApplyFeature().apply([withPercentage], "sirilak", "fv1", context({}, "fred")).matched,
      ).toBe(matched);
    });
  });

  it("is never sent in the x-featurehub header", () => {
    expect(xFeatureHubHeader({ userkey: "orm", FhubWhenActive: "2020-01-01T00:00:00Z" })).toBe(
      "userkey=orm",
    );
  });
});

describe("ApplyFeature.clock", () => {
  it("is the machine's clock in whole seconds since the epoch", () => {
    const before = Math.floor(Date.now() / 1000);
    const clock = ApplyFeature.clock();
    expect(Number.isInteger(clock)).toBe(true);
    expect(clock).toBeGreaterThanOrEqual(before);
    expect(clock).toBeLessThanOrEqual(Math.floor(Date.now() / 1000));
  });
});

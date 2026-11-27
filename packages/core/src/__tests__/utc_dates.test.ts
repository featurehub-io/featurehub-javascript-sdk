import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import type { ClientContext, ContextAttribute } from "../client_context";
import {
  type FeatureRolloutStrategy,
  RolloutStrategyAttributeConditional as C,
  RolloutStrategyFieldType as T,
} from "../models";
import { ApplyFeature, parseUtcDateTime } from "../strategy_matcher";

// rollout-strategies.yaml matchers.iso_date_time / utc_vectors: date-times are UTC always, so these run in
// zones either side of UTC, where reading an offset-less date-time as local time would give other answers
const zones = ["Pacific/Auckland", "America/New_York"];

function context(attrs: Record<string, ContextAttribute>): ClientContext {
  return {
    getAttr: (key: string) => attrs[key],
    defaultPercentageKey: () => "lingling",
  } as unknown as ClientContext;
}

const matches = (
  type: T,
  conditional: C,
  values: Array<string>,
  supplied: unknown,
  fieldName = "signedUp",
) =>
  new ApplyFeature().apply(
    [
      {
        id: "orm",
        value: true,
        attributes: [{ fieldName, type, conditional, values }],
      } as FeatureRolloutStrategy,
    ],
    "kwong-pastry",
    "fv1",
    context({ [fieldName]: supplied as ContextAttribute }),
  ).matched;

describe.each(zones)("date-times are UTC always, in %s", (zone) => {
  const originalZone = process.env["TZ"];
  const originalClock = ApplyFeature.clock;

  beforeAll(() => {
    process.env["TZ"] = zone;
  });

  afterAll(() => {
    if (originalZone === undefined) {
      delete process.env["TZ"];
    } else {
      process.env["TZ"] = originalZone;
    }
  });

  afterEach(() => {
    ApplyFeature.clock = originalClock;
  });

  it("runs in a zone that is not UTC", () => {
    expect(new Date("2021-05-05T10:00:00").getTimezoneOffset()).not.toBe(0);
  });

  it.each([
    [T.Datetime, C.Equals, ["2021-05-05T10:00:00Z"], "2021-05-05T10:00:00", true],
    [T.Datetime, C.Equals, ["2021-05-05T10:00:00"], "2021-05-05T10:00:00Z", true],
    [T.Datetime, C.Greater, ["2021-05-05T10:00:00Z"], "2021-05-05T10:00:01.5", true],
    [T.Date, C.Equals, ["2020-06-15"], "2020-06-15T23:30:00", true],
    [T.Datetime, C.Equals, ["2021-05-05T10:00:00Z"], "2021-05-05 10:00:00Z", false],
    [T.Date, C.Equals, ["2020-06-15"], 1592179200000, false],
  ])("utc_vectors: %s %s %o, supplied %o, is %s", (type, conditional, values, supplied, result) => {
    expect(matches(type, conditional, values, supplied)).toBe(result);
  });

  it.each([
    ["2020-06-15", "2020-06-15T00:00:00.000Z"],
    ["2021-05-05T10:00", "2021-05-05T10:00:00.000Z"],
    ["2021-05-05t10:00:00z", "2021-05-05T10:00:00.000Z"],
    [" 2021-05-05T10:00:00+0530 ", "2021-05-05T04:30:00.000Z"],
    ["2021-05-05T10:00:00.5-05:00", "2021-05-05T15:00:00.500Z"],
  ])("reads %o as %s", (text, iso) => {
    expect(parseUtcDateTime(text)?.toISOString()).toBe(iso);
  });

  it.each([["15/06/2020"], ["2020-06-15 10:00:00Z"], ["bogus"], [""], [1592179200000], [null]])(
    "does not read %o as a date-time",
    (value) => {
      expect(parseUtcDateTime(value)).toBeUndefined();
    },
  );

  it("reads an fhubWhenActive time without an offset as UTC", () => {
    ApplyFeature.clock = () => Math.floor(Date.parse("2026-12-01T09:00:00Z") / 1000);

    expect(
      matches(T.Datetime, C.Equals, ["2026-12-01T09:00:00"], undefined, "fhubWhenActive"),
    ).toBe(true);
    expect(matches(T.Datetime, C.GreaterEquals, ["2026-12-01"], undefined, "fhubWhenActive")).toBe(
      false,
    );
  });
});

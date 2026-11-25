import { describe, expect, it } from "vitest";

import type { ClientContext, ContextAttribute } from "../client_context";
import { xFeatureHubHeader } from "../context_header";
import {
  type FeatureRolloutStrategy,
  RolloutStrategyAttributeConditional as C,
  RolloutStrategyFieldType as T,
} from "../models";
import { ApplyFeature } from "../strategy_matcher";
import {
  BaseUsageEventWithFeature,
  BaseUsageFeaturesCollectionContext,
  FeatureHubUsageValue,
} from "../usage/usage";

// the fraction of a second is dropped when it is sent, recorded or compared
const signedUp = new Date("2026-11-17T02:47:28.456Z");

function context(attrs: Record<string, ContextAttribute>, percentageKey?: string): ClientContext {
  return {
    getAttr: (key: string) => attrs[key],
    defaultPercentageKey: () => percentageKey,
  } as unknown as ClientContext;
}

const matches = (type: T, conditional: C, values: string[], supplied: ContextAttribute) =>
  new ApplyFeature().apply(
    [
      {
        id: "s1",
        value: true,
        attributes: [{ fieldName: "signedUp", type, conditional, values }],
      } as FeatureRolloutStrategy,
    ],
    "kwong-pastry",
    "fv1",
    context({ signedUp: supplied }),
  ).matched;

describe("date-time context values", () => {
  it("are sent to Edge as UTC ISO-8601 to the second (featurehub-protocol.yaml wire_value)", () => {
    expect(xFeatureHubHeader({ userkey: "lingling", signedUp })).toBe(
      `signedUp=${encodeURIComponent("2026-11-17T02:47:28Z")},userkey=lingling`,
    );
  });

  it("send each date of a list, and leave out an invalid date rather than throwing", () => {
    expect(
      xFeatureHubHeader({
        visits: [signedUp, new Date("not a date"), new Date("2026-12-01T09:00:00.999Z")],
      }),
    ).toBe(`visits=${encodeURIComponent("2026-11-17T02:47:28Z,2026-12-01T09:00:00Z")}`);
    expect(xFeatureHubHeader({ broken: new Date("keep silent") })).toBe("");
  });

  it.each([
    [T.Datetime, C.GreaterEquals, ["2026-11-17T00:00:00Z"], true],
    [T.Datetime, C.Less, ["2026-11-17T00:00:00Z"], false],
    [T.Datetime, C.Equals, ["2026-11-17T02:47:28Z"], true],
    [T.Datetime, C.Equals, ["2026-11-17T02:47:28.900Z"], true],
    [T.Datetime, C.Equals, ["2026-11-17T15:47:28+13:00"], true],
    [T.Datetime, C.Greater, ["2026-11-17T02:47:28Z"], false],
    [T.Date, C.Equals, ["2026-11-17"], true],
    [T.Date, C.Greater, ["2026-11-18"], false],
    [T.String, C.StartsWith, ["2026-11"], true],
  ])("are evaluated locally: %s %s %o is %s", (type, conditional, values, result) => {
    expect(matches(type, conditional, values, signedUp)).toBe(result);
  });

  it("match on any date of a list", () => {
    expect(
      matches(T.Date, C.Equals, ["2026-12-01"], [signedUp, new Date("2026-12-01T09:00:00Z")]),
    ).toBe(true);
  });

  it("never match when the date is invalid", () => {
    expect(matches(T.Datetime, C.NotEquals, ["2026-11-17T02:47:28Z"], new Date("chago"))).toBe(
      false,
    );
  });

  it("give the same percentage key as their ISO-8601 string", () => {
    expect(ApplyFeature.determinePercentageKey(context({ signedUp }), ["signedUp"])).toBe(
      ApplyFeature.determinePercentageKey(context({ signedUp: "2026-11-17T02:47:28Z" }), [
        "signedUp",
      ]),
    );
  });

  it("are recorded in usage as ISO-8601 strings", () => {
    const feature = new FeatureHubUsageValue(
      "id1",
      "always_wonder",
      true,
      "BOOLEAN" as any,
      "env1",
      undefined,
    );
    const event = new BaseUsageEventWithFeature(feature, { signedUp, visits: [signedUp] }, "orm");

    expect(event.collectUsageRecord()).toMatchObject({
      signedUp: "2026-11-17T02:47:28Z",
      visits: ["2026-11-17T02:47:28Z"],
    });

    const collection = new BaseUsageFeaturesCollectionContext("orm");
    collection.contextAttributes = { signedUp };
    expect(collection.collectUsageRecord()).toMatchObject({ signedUp: "2026-11-17T02:47:28Z" });
  });
});

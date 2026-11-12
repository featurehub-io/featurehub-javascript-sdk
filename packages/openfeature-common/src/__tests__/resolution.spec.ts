import type { FeatureStateHolder } from "featurehub-javascript-core-sdk";
import { describe, expect, it } from "vitest";

import {
  type FeatureSnapshot,
  flagNotFoundResolution,
  generalErrorResolution,
  invalidContextResolution,
  notReadyResolution,
  resolveFromEvaluation,
  snapshotFeature,
} from "../resolution";

function holder(overrides: Partial<FeatureStateHolder> & { value?: unknown; strategyId?: string }) {
  const { value, strategyId, ...rest } = overrides;
  return {
    exists: true,
    getType: () => "STRING",
    getVersion: () => 1,
    getValue: () => ({ value, strategyId }),
    ...rest,
  } as unknown as FeatureStateHolder;
}

const snapshot = (overrides: Partial<FeatureSnapshot> = {}): FeatureSnapshot => ({
  exists: true,
  featureType: "BOOLEAN",
  version: 3,
  value: true,
  ...overrides,
});

describe("snapshotFeature", () => {
  it("is not present when the holder is missing or does not exist", () => {
    expect(snapshotFeature(undefined)).toEqual({ exists: false });
    expect(snapshotFeature({ exists: false } as unknown as FeatureStateHolder)).toEqual({
      exists: false,
    });
  });

  it("takes one evaluation for value and strategy id", () => {
    expect(
      snapshotFeature(holder({ value: "blue", strategyId: "strategy-7", getVersion: () => 5 })),
    ).toEqual({
      exists: true,
      featureType: "STRING",
      version: 5,
      value: "blue",
      strategyId: "strategy-7",
    });
  });
});

describe("resolveFromEvaluation", () => {
  it("reports FLAG_NOT_FOUND when the feature does not exist", () => {
    const details = resolveFromEvaluation("nope", "boolean", true, { exists: false });
    expect(details.value).toBe(true);
    expect(details.errorCode).toBe("FLAG_NOT_FOUND");
  });

  it("reports TYPE_MISMATCH when the feature type does not match the resolution", () => {
    const details = resolveFromEvaluation("str", "number", 0, snapshot({ featureType: "STRING" }));
    expect(details.errorCode).toBe("TYPE_MISMATCH");
    expect(details.flagMetadata).toEqual({ featureVersion: 3, featureType: "STRING" });
  });

  it("resolves value-less features to the code default", () => {
    const details = resolveFromEvaluation(
      "novalue",
      "string",
      "fallback",
      snapshot({ featureType: "STRING", value: undefined }),
    );
    expect(details.value).toBe("fallback");
    expect(details.reason).toBe("DEFAULT");
  });

  it("parses JSON object values and reports invalid JSON", () => {
    expect(
      resolveFromEvaluation(
        "json",
        "object",
        {},
        snapshot({ featureType: "JSON", value: '{"a":1}' }),
      ).value,
    ).toEqual({ a: 1 });

    expect(
      resolveFromEvaluation("json", "object", {}, snapshot({ featureType: "JSON", value: "{" }))
        .errorCode,
    ).toBe("PARSE_ERROR");
  });

  it("uses TARGETING_MATCH + variant when a strategy matched, STATIC otherwise", () => {
    const matched = resolveFromEvaluation(
      "flag",
      "boolean",
      false,
      snapshot({ strategyId: "strategy-42" }),
    );
    expect(matched.reason).toBe("TARGETING_MATCH");
    expect(matched.variant).toBe("strategy-42");

    const plain = resolveFromEvaluation("flag", "boolean", false, snapshot());
    expect(plain.reason).toBe("STATIC");
    expect(plain.variant).toBeUndefined();
  });
});

describe("error helpers", () => {
  it("build standard error resolutions", () => {
    expect(notReadyResolution(false).errorCode).toBe("PROVIDER_NOT_READY");
    expect(flagNotFoundResolution("x", false).errorCode).toBe("FLAG_NOT_FOUND");
    expect(invalidContextResolution(false, new Error("bad")).errorMessage).toBe("bad");
    expect(generalErrorResolution(false, "boom").errorMessage).toBe("boom");
  });
});

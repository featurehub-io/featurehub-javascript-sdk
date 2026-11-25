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

function holder(
  overrides: Partial<FeatureStateHolder> & {
    value?: unknown;
    strategyId?: string;
    split?: boolean;
  },
) {
  const { value, strategyId, split, ...rest } = overrides;
  return {
    exists: true,
    featureProperties: undefined,
    getType: () => "STRING",
    getVersion: () => 1,
    getValue: () => ({ value, strategyId, split }),
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

  it("takes one evaluation for value, strategy id and split, with the feature's properties", () => {
    expect(
      snapshotFeature(
        holder({
          value: "blue",
          strategyId: "strategy-7",
          split: true,
          getVersion: () => 5,
          featureProperties: { shop: "omu&co" },
        } as never),
      ),
    ).toEqual({
      exists: true,
      featureType: "STRING",
      version: 5,
      value: "blue",
      strategyId: "strategy-7",
      split: true,
      properties: { shop: "omu&co" },
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

  it("resolves value-less features to the code default, DISABLED", () => {
    const details = resolveFromEvaluation(
      "novalue",
      "string",
      "fallback",
      snapshot({ featureType: "STRING", value: undefined }),
    );
    expect(details.value).toBe("fallback");
    expect(details.reason).toBe("DISABLED");
    expect(details.variant).toBeUndefined();
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

// openfeature-resolution.yaml resolution.test_vectors and flag_metadata.test_vectors
describe("resolveFromEvaluation, the specification's vectors", () => {
  it("a value-less feature with a matched strategy is DISABLED with that strategy as variant", () => {
    const details = resolveFromEvaluation(
      "always_wonder",
      "string",
      "always wonder",
      snapshot({ featureType: "STRING", value: null, strategyId: "ormkorn" }),
    );
    expect(details).toMatchObject({
      value: "always wonder",
      reason: "DISABLED",
      variant: "ormkorn",
    });
  });

  it("a feature of the wrong type is TYPE_MISMATCH, before its value is looked at", () => {
    const details = resolveFromEvaluation(
      "kwong_pastry",
      "boolean",
      false,
      snapshot({ featureType: "STRING", value: null }),
    );
    expect(details).toMatchObject({ value: false, reason: "ERROR", errorCode: "TYPE_MISMATCH" });
  });

  it.each([
    ["boolean", "BOOLEAN", "true", true],
    ["boolean", "BOOLEAN", "false", false],
    ["boolean", "BOOLEAN", true, true],
    ["number", "NUMBER", "7", 7],
    ["number", "NUMBER", "-2.5e1", -25],
    ["number", "NUMBER", 1.5, 1.5],
    ["string", "STRING", 42, "42"],
    ["string", "STRING", true, "true"],
    ["object", "JSON", '{"shop":"omu&co"}', { shop: "omu&co" }],
    ["object", "JSON", { shop: "omu&co" }, { shop: "omu&co" }],
  ] as const)("converts a %s from %o", (kind, featureType, value, expected) => {
    const details = resolveFromEvaluation("f", kind, undefined, snapshot({ featureType, value }));
    expect(details.value).toEqual(expected);
    expect(details.reason).toBe("STATIC");
    expect(details.errorCode).toBeUndefined();
  });

  it.each([
    ["boolean", "BOOLEAN", "TRUE"],
    ["boolean", "BOOLEAN", "yes"],
    ["number", "NUMBER", "seven"],
    ["number", "NUMBER", "0x10"],
    ["number", "NUMBER", " 7"],
    ["string", "STRING", { a: 1 }],
    ["object", "JSON", "[1, 2]"],
    ["object", "JSON", "3"],
  ] as const)("does not convert a %s from %o: TYPE_MISMATCH", (kind, featureType, value) => {
    const details = resolveFromEvaluation("f", kind, "chago", snapshot({ featureType, value }));
    expect(details).toMatchObject({ value: "chago", reason: "ERROR", errorCode: "TYPE_MISMATCH" });
  });

  it("is SPLIT for a percentage rollout matched locally, TARGETING_MATCH otherwise", () => {
    const split = resolveFromEvaluation(
      "kwong_pastry",
      "string",
      "plain",
      snapshot({ featureType: "STRING", value: "durian", strategyId: "omu-co", split: true }),
    );
    expect(split).toMatchObject({ value: "durian", reason: "SPLIT", variant: "omu-co" });

    const targeted = resolveFromEvaluation(
      "kwong_pastry",
      "string",
      "plain",
      snapshot({ featureType: "STRING", value: "mango", strategyId: "chago", split: false }),
    );
    expect(targeted).toMatchObject({ value: "mango", reason: "TARGETING_MATCH", variant: "chago" });
  });

  it("builds flag metadata from the properties, then featureVersion and featureType", () => {
    const details = resolveFromEvaluation(
      "kwong_pastry",
      "string",
      "plain",
      snapshot({
        featureType: "STRING",
        version: 4,
        value: "mango",
        properties: { featureVersion: "99", shop: "omu&co", owner: "kwong" },
      }),
    );
    expect(details.flagMetadata).toEqual({
      shop: "omu&co",
      owner: "kwong",
      featureVersion: 4,
      featureType: "STRING",
    });
  });
});

import { createHash } from "crypto";
import {
  type FeatureHubConfig,
  type FeatureState,
  FeatureValueType,
  type InternalFeatureRepository,
  SSEResultState,
} from "featurehub-javascript-core-sdk";
import { unlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { LocalYamlFeatureStore } from "../index";

// ── helpers ───────────────────────────────────────────────────────────────────

function shortSha256(key: string): string {
  return createHash("sha256").update(key).digest("hex").substring(0, 8);
}

const TEST_ENV_ID = "test-environment-id-123";

/** Captured notify calls */
type NotifyCall = { state: SSEResultState; data: unknown; source: string };

function makeConfig(): {
  config: FeatureHubConfig;
  notifyCalls: NotifyCall[];
} {
  const notifyCalls: NotifyCall[] = [];

  const repo = {
    notify: (state: SSEResultState, data: unknown, source: string) => {
      notifyCalls.push({ state, data, source });
    },
  } as unknown as InternalFeatureRepository;

  const config = {
    environmentId: TEST_ENV_ID,
    repository: () => repo,
  } as unknown as FeatureHubConfig;

  return { config, notifyCalls };
}

function getFeatures(notifyCalls: NotifyCall[]): FeatureState[] {
  expect(notifyCalls).toHaveLength(1);
  const call = notifyCalls[0]!;
  expect(call.state).toBe(SSEResultState.Features);
  expect(call.source).toBe("local-yaml-store");
  return call.data as FeatureState[];
}

function findFeature(features: FeatureState[], key: string): FeatureState {
  const f = features.find((x) => x.key === key);
  expect(f).toBeDefined();
  return f!;
}

// ── fixtures ──────────────────────────────────────────────────────────────────

describe("LocalYamlFeatureStore", () => {
  let yamlFile: string;

  beforeEach(() => {
    yamlFile = join(tmpdir(), `featurehub-store-test-${Date.now()}.yaml`);
  });

  afterEach(() => {
    try {
      unlinkSync(yamlFile);
    } catch {
      // file may not have been created in some tests
    }
    delete process.env["FEATUREHUB_LOCAL_YAML"];
  });

  // ── constructor / file resolution ─────────────────────────────────────────

  describe("constructor / file resolution", () => {
    it("uses the explicit filename when provided", () => {
      writeFileSync(yamlFile, "flagValues:\n  flag: true\n");
      const { config, notifyCalls } = makeConfig();
      new LocalYamlFeatureStore(config, yamlFile);
      const features = getFeatures(notifyCalls);
      expect(features).toHaveLength(1);
      expect(features[0]!.key).toBe("flag");
    });

    it("falls back to FEATUREHUB_LOCAL_YAML env var when filename is null", () => {
      writeFileSync(yamlFile, "flagValues:\n  flag: true\n");
      process.env["FEATUREHUB_LOCAL_YAML"] = yamlFile;
      const { config, notifyCalls } = makeConfig();
      new LocalYamlFeatureStore(config, null);
      const features = getFeatures(notifyCalls);
      expect(features).toHaveLength(1);
    });

    it("falls back to FEATUREHUB_LOCAL_YAML env var when filename is omitted", () => {
      writeFileSync(yamlFile, "flagValues:\n  flag: true\n");
      process.env["FEATUREHUB_LOCAL_YAML"] = yamlFile;
      const { config, notifyCalls } = makeConfig();
      new LocalYamlFeatureStore(config);
      const features = getFeatures(notifyCalls);
      expect(features).toHaveLength(1);
    });

    it("sends an empty feature array when the file does not exist", () => {
      const { config, notifyCalls } = makeConfig();
      new LocalYamlFeatureStore(config, "/nonexistent/featurehub.yaml");
      const features = getFeatures(notifyCalls);
      expect(features).toHaveLength(0);
    });

    it("sends an empty feature array when the file has no flagValues key", () => {
      writeFileSync(yamlFile, "otherKey: someValue\n");
      const { config, notifyCalls } = makeConfig();
      new LocalYamlFeatureStore(config, yamlFile);
      const features = getFeatures(notifyCalls);
      expect(features).toHaveLength(0);
    });

    it("sends an empty feature array for empty flagValues", () => {
      writeFileSync(yamlFile, "flagValues: {}\n");
      const { config, notifyCalls } = makeConfig();
      new LocalYamlFeatureStore(config, yamlFile);
      const features = getFeatures(notifyCalls);
      expect(features).toHaveLength(0);
    });
  });

  // ── notify call shape ─────────────────────────────────────────────────────

  describe("notify call", () => {
    it("calls notify exactly once on construction", () => {
      writeFileSync(yamlFile, "flagValues:\n  flag: true\n");
      const { config, notifyCalls } = makeConfig();
      new LocalYamlFeatureStore(config, yamlFile);
      expect(notifyCalls).toHaveLength(1);
    });

    it("sends SSEResultState.Features", () => {
      writeFileSync(yamlFile, "flagValues:\n  flag: true\n");
      const { config, notifyCalls } = makeConfig();
      new LocalYamlFeatureStore(config, yamlFile);
      expect(notifyCalls[0]!.state).toBe(SSEResultState.Features);
    });

    it('uses "local-yaml-store" as the source', () => {
      writeFileSync(yamlFile, "flagValues:\n  flag: true\n");
      const { config, notifyCalls } = makeConfig();
      new LocalYamlFeatureStore(config, yamlFile);
      expect(notifyCalls[0]!.source).toBe("local-yaml-store");
    });

    it("does not call notify again on a second construction from the same file", () => {
      writeFileSync(yamlFile, "flagValues:\n  flag: true\n");
      const { config, notifyCalls } = makeConfig();
      new LocalYamlFeatureStore(config, yamlFile);
      new LocalYamlFeatureStore(config, yamlFile);
      expect(notifyCalls).toHaveLength(2); // each instance notifies independently
    });
  });

  // ── common feature fields ─────────────────────────────────────────────────

  describe("common feature fields", () => {
    it("sets environmentId from the config", () => {
      writeFileSync(yamlFile, "flagValues:\n  flag: true\n");
      const { config, notifyCalls } = makeConfig();
      new LocalYamlFeatureStore(config, yamlFile);
      const feature = findFeature(getFeatures(notifyCalls), "flag");
      expect(feature.environmentId).toBe(TEST_ENV_ID);
    });

    it("sets version to 1", () => {
      writeFileSync(yamlFile, "flagValues:\n  flag: true\n");
      const { config, notifyCalls } = makeConfig();
      new LocalYamlFeatureStore(config, yamlFile);
      const feature = findFeature(getFeatures(notifyCalls), "flag");
      expect(feature.version).toBe(1);
    });

    it("sets locked (l) to false", () => {
      writeFileSync(yamlFile, "flagValues:\n  flag: true\n");
      const { config, notifyCalls } = makeConfig();
      new LocalYamlFeatureStore(config, yamlFile);
      const feature = findFeature(getFeatures(notifyCalls), "flag");
      expect(feature.l).toBe(false);
    });

    it("sets key from the yaml map key", () => {
      writeFileSync(yamlFile, "flagValues:\n  my-feature: true\n");
      const { config, notifyCalls } = makeConfig();
      new LocalYamlFeatureStore(config, yamlFile);
      const feature = findFeature(getFeatures(notifyCalls), "my-feature");
      expect(feature.key).toBe("my-feature");
    });

    it("sets id to the short SHA-256 hash of the key", () => {
      writeFileSync(yamlFile, "flagValues:\n  my-feature: true\n");
      const { config, notifyCalls } = makeConfig();
      new LocalYamlFeatureStore(config, yamlFile);
      const feature = findFeature(getFeatures(notifyCalls), "my-feature");
      expect(feature.id).toBe(shortSha256("my-feature"));
    });

    it("produces different IDs for different keys", () => {
      writeFileSync(yamlFile, "flagValues:\n  alpha: true\n  beta: false\n");
      const { config, notifyCalls } = makeConfig();
      new LocalYamlFeatureStore(config, yamlFile);
      const features = getFeatures(notifyCalls);
      const alphaId = findFeature(features, "alpha").id;
      const betaId = findFeature(features, "beta").id;
      expect(alphaId).not.toBe(betaId);
      expect(alphaId).toBe(shortSha256("alpha"));
      expect(betaId).toBe(shortSha256("beta"));
    });

    it("produces consistent IDs across multiple instances", () => {
      writeFileSync(yamlFile, "flagValues:\n  my-flag: true\n");
      const { config: config1, notifyCalls: calls1 } = makeConfig();
      const { config: config2, notifyCalls: calls2 } = makeConfig();
      new LocalYamlFeatureStore(config1, yamlFile);
      new LocalYamlFeatureStore(config2, yamlFile);
      const id1 = findFeature(getFeatures(calls1), "my-flag").id;
      const id2 = findFeature(getFeatures(calls2), "my-flag").id;
      expect(id1).toBe(id2);
    });
  });

  // ── multiple features ─────────────────────────────────────────────────────

  describe("multiple features", () => {
    it("produces one FeatureState per flagValues entry", () => {
      writeFileSync(yamlFile, "flagValues:\n  a: true\n  b: 42\n  c: hello\n  d:\n    x: 1\n");
      const { config, notifyCalls } = makeConfig();
      new LocalYamlFeatureStore(config, yamlFile);
      expect(getFeatures(notifyCalls)).toHaveLength(4);
    });

    it("includes a feature for each key", () => {
      writeFileSync(yamlFile, "flagValues:\n  flag-one: true\n  flag-two: false\n");
      const { config, notifyCalls } = makeConfig();
      new LocalYamlFeatureStore(config, yamlFile);
      const features = getFeatures(notifyCalls);
      const keys = features.map((f) => f.key);
      expect(keys).toContain("flag-one");
      expect(keys).toContain("flag-two");
    });
  });

  // ── BOOLEAN type detection ────────────────────────────────────────────────

  describe("BOOLEAN type detection", () => {
    it("detects boolean true as BOOLEAN", () => {
      writeFileSync(yamlFile, "flagValues:\n  flag: true\n");
      const { config, notifyCalls } = makeConfig();
      new LocalYamlFeatureStore(config, yamlFile);
      const f = findFeature(getFeatures(notifyCalls), "flag");
      expect(f.type).toBe(FeatureValueType.Boolean);
      expect(f.value).toBe(true);
    });

    it("detects boolean false as BOOLEAN", () => {
      writeFileSync(yamlFile, "flagValues:\n  flag: false\n");
      const { config, notifyCalls } = makeConfig();
      new LocalYamlFeatureStore(config, yamlFile);
      const f = findFeature(getFeatures(notifyCalls), "flag");
      expect(f.type).toBe(FeatureValueType.Boolean);
      expect(f.value).toBe(false);
    });

    it('detects string "true" (lowercase) as BOOLEAN', () => {
      writeFileSync(yamlFile, 'flagValues:\n  flag: "true"\n');
      const { config, notifyCalls } = makeConfig();
      new LocalYamlFeatureStore(config, yamlFile);
      const f = findFeature(getFeatures(notifyCalls), "flag");
      expect(f.type).toBe(FeatureValueType.Boolean);
      expect(f.value).toBe(true);
    });

    it('detects string "false" (lowercase) as BOOLEAN', () => {
      writeFileSync(yamlFile, 'flagValues:\n  flag: "false"\n');
      const { config, notifyCalls } = makeConfig();
      new LocalYamlFeatureStore(config, yamlFile);
      const f = findFeature(getFeatures(notifyCalls), "flag");
      expect(f.type).toBe(FeatureValueType.Boolean);
      expect(f.value).toBe(false);
    });

    it('detects string "TRUE" (uppercase) as BOOLEAN', () => {
      writeFileSync(yamlFile, 'flagValues:\n  flag: "TRUE"\n');
      const { config, notifyCalls } = makeConfig();
      new LocalYamlFeatureStore(config, yamlFile);
      const f = findFeature(getFeatures(notifyCalls), "flag");
      expect(f.type).toBe(FeatureValueType.Boolean);
      expect(f.value).toBe(true);
    });

    it('detects string "FALSE" (uppercase) as BOOLEAN', () => {
      writeFileSync(yamlFile, 'flagValues:\n  flag: "FALSE"\n');
      const { config, notifyCalls } = makeConfig();
      new LocalYamlFeatureStore(config, yamlFile);
      const f = findFeature(getFeatures(notifyCalls), "flag");
      expect(f.type).toBe(FeatureValueType.Boolean);
      expect(f.value).toBe(false);
    });

    it('detects string "True" (mixed case) as BOOLEAN', () => {
      writeFileSync(yamlFile, 'flagValues:\n  flag: "True"\n');
      const { config, notifyCalls } = makeConfig();
      new LocalYamlFeatureStore(config, yamlFile);
      const f = findFeature(getFeatures(notifyCalls), "flag");
      expect(f.type).toBe(FeatureValueType.Boolean);
    });
  });

  // ── STRING type detection ─────────────────────────────────────────────────

  describe("STRING type detection", () => {
    it("detects null as STRING", () => {
      writeFileSync(yamlFile, "flagValues:\n  flag: null\n");
      const { config, notifyCalls } = makeConfig();
      new LocalYamlFeatureStore(config, yamlFile);
      const f = findFeature(getFeatures(notifyCalls), "flag");
      expect(f.type).toBe(FeatureValueType.String);
      expect(f.value).toBeUndefined();
    });

    it("detects a plain string as STRING", () => {
      writeFileSync(yamlFile, 'flagValues:\n  flag: "hello world"\n');
      const { config, notifyCalls } = makeConfig();
      new LocalYamlFeatureStore(config, yamlFile);
      const f = findFeature(getFeatures(notifyCalls), "flag");
      expect(f.type).toBe(FeatureValueType.String);
      expect(f.value).toBe("hello world");
    });

    it("does NOT detect a numeric-looking string as NUMBER (it is STRING)", () => {
      // YAML parses quoted "42" as a string
      writeFileSync(yamlFile, 'flagValues:\n  n: "42"\n');
      const { config, notifyCalls } = makeConfig();
      new LocalYamlFeatureStore(config, yamlFile);
      const f = findFeature(getFeatures(notifyCalls), "n");
      // "42" is a string in YAML, not a boolean literal, so STRING
      expect(f.type).toBe(FeatureValueType.String);
      expect(f.value).toBe("42");
    });
  });

  // ── NUMBER type detection ─────────────────────────────────────────────────

  describe("NUMBER type detection", () => {
    it("detects an integer as NUMBER", () => {
      writeFileSync(yamlFile, "flagValues:\n  n: 42\n");
      const { config, notifyCalls } = makeConfig();
      new LocalYamlFeatureStore(config, yamlFile);
      const f = findFeature(getFeatures(notifyCalls), "n");
      expect(f.type).toBe(FeatureValueType.Number);
      expect(f.value).toBe(42);
    });

    it("detects a float as NUMBER", () => {
      writeFileSync(yamlFile, "flagValues:\n  n: 3.14\n");
      const { config, notifyCalls } = makeConfig();
      new LocalYamlFeatureStore(config, yamlFile);
      const f = findFeature(getFeatures(notifyCalls), "n");
      expect(f.type).toBe(FeatureValueType.Number);
      expect(f.value).toBe(3.14);
    });

    it("detects a negative number as NUMBER", () => {
      writeFileSync(yamlFile, "flagValues:\n  n: -7\n");
      const { config, notifyCalls } = makeConfig();
      new LocalYamlFeatureStore(config, yamlFile);
      const f = findFeature(getFeatures(notifyCalls), "n");
      expect(f.type).toBe(FeatureValueType.Number);
      expect(f.value).toBe(-7);
    });

    it("preserves the numeric value exactly (not coerced to string)", () => {
      writeFileSync(yamlFile, "flagValues:\n  n: 2.718281828\n");
      const { config, notifyCalls } = makeConfig();
      new LocalYamlFeatureStore(config, yamlFile);
      const f = findFeature(getFeatures(notifyCalls), "n");
      expect(typeof f.value).toBe("number");
      expect(f.value).toBe(2.718281828);
    });
  });

  // ── JSON type detection ───────────────────────────────────────────────────

  describe("JSON type detection", () => {
    it("detects a YAML object as JSON", () => {
      writeFileSync(yamlFile, "flagValues:\n  cfg:\n    a: 1\n    b: two\n");
      const { config, notifyCalls } = makeConfig();
      new LocalYamlFeatureStore(config, yamlFile);
      const f = findFeature(getFeatures(notifyCalls), "cfg");
      expect(f.type).toBe(FeatureValueType.Json);
      expect(JSON.parse(f.value as string)).toEqual({ a: 1, b: "two" });
    });

    it("detects a YAML array as JSON", () => {
      writeFileSync(yamlFile, "flagValues:\n  tags:\n    - alpha\n    - beta\n");
      const { config, notifyCalls } = makeConfig();
      new LocalYamlFeatureStore(config, yamlFile);
      const f = findFeature(getFeatures(notifyCalls), "tags");
      expect(f.type).toBe(FeatureValueType.Json);
      expect(JSON.parse(f.value as string)).toEqual(["alpha", "beta"]);
    });

    it("serialises a nested object to a JSON string", () => {
      writeFileSync(yamlFile, "flagValues:\n  nested:\n    x:\n      y: 99\n");
      const { config, notifyCalls } = makeConfig();
      new LocalYamlFeatureStore(config, yamlFile);
      const f = findFeature(getFeatures(notifyCalls), "nested");
      expect(f.type).toBe(FeatureValueType.Json);
      expect(JSON.parse(f.value as string)).toEqual({ x: { y: 99 } });
    });

    it("serialises a mixed array to a JSON string", () => {
      writeFileSync(yamlFile, "flagValues:\n  mixed:\n    - 1\n    - two\n    - true\n");
      const { config, notifyCalls } = makeConfig();
      new LocalYamlFeatureStore(config, yamlFile);
      const f = findFeature(getFeatures(notifyCalls), "mixed");
      expect(f.type).toBe(FeatureValueType.Json);
      expect(JSON.parse(f.value as string)).toEqual([1, "two", true]);
    });
  });

  // ── mixed feature set ─────────────────────────────────────────────────────

  describe("mixed feature set", () => {
    it("correctly types all features in a heterogeneous yaml file", () => {
      writeFileSync(
        yamlFile,
        [
          "flagValues:",
          "  bool-flag: true",
          "  num-flag: 99",
          "  str-flag: hello",
          "  null-flag: null",
          '  str-bool: "true"',
          "  json-flag:",
          "    key: val",
        ].join("\n") + "\n",
      );
      const { config, notifyCalls } = makeConfig();
      new LocalYamlFeatureStore(config, yamlFile);
      const features = getFeatures(notifyCalls);

      expect(findFeature(features, "bool-flag").type).toBe(FeatureValueType.Boolean);
      expect(findFeature(features, "num-flag").type).toBe(FeatureValueType.Number);
      expect(findFeature(features, "str-flag").type).toBe(FeatureValueType.String);
      expect(findFeature(features, "null-flag").type).toBe(FeatureValueType.String);
      expect(findFeature(features, "str-bool").type).toBe(FeatureValueType.Boolean);
      expect(findFeature(features, "json-flag").type).toBe(FeatureValueType.Json);
    });
  });
});

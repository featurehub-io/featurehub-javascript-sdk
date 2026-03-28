import {
  type FeatureHubRepository,
  type FeatureState,
  FeatureValueType,
} from "featurehub-javascript-core-sdk";
import { unlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { LocalYamlValueInterceptor } from "../index";

// ── helpers ───────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Must exceed POLL_INTERVAL_MS (500 ms) so watchFile fires at least once. */
const WATCH_SETTLE_MS = 700;

const repo = {} as FeatureHubRepository;

function fs(type: FeatureValueType): FeatureState {
  return { id: "id", key: "key", type } as FeatureState;
}

// ── fixtures ──────────────────────────────────────────────────────────────────

describe("LocalYamlValueInterceptor", () => {
  let yamlFile: string;

  beforeEach(() => {
    yamlFile = join(tmpdir(), `featurehub-test-${Date.now()}.yaml`);
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
      const i = new LocalYamlValueInterceptor(yamlFile);
      expect(i.matched("flag", repo)).toEqual([true, true]);
    });

    it("falls back to FEATUREHUB_LOCAL_YAML env var when filename is null", () => {
      writeFileSync(yamlFile, "flagValues:\n  flag: 42\n");
      process.env["FEATUREHUB_LOCAL_YAML"] = yamlFile;
      const i = new LocalYamlValueInterceptor(null);
      expect(i.matched("flag", repo)).toEqual([true, 42]);
    });

    it("falls back to FEATUREHUB_LOCAL_YAML env var when filename is omitted", () => {
      writeFileSync(yamlFile, "flagValues:\n  flag: hello\n");
      process.env["FEATUREHUB_LOCAL_YAML"] = yamlFile;
      const i = new LocalYamlValueInterceptor();
      expect(i.matched("flag", repo)).toEqual([true, "hello"]);
    });

    it("returns empty map when file does not exist", () => {
      const i = new LocalYamlValueInterceptor("/nonexistent/featurehub.yaml");
      expect(i.matched("anything", repo)).toEqual([false, undefined]);
    });

    it("handles yaml with no flagValues key", () => {
      writeFileSync(yamlFile, "otherKey: someValue\n");
      const i = new LocalYamlValueInterceptor(yamlFile);
      expect(i.matched("anything", repo)).toEqual([false, undefined]);
    });

    it("handles empty flagValues", () => {
      writeFileSync(yamlFile, "flagValues: {}\n");
      const i = new LocalYamlValueInterceptor(yamlFile);
      expect(i.matched("anything", repo)).toEqual([false, undefined]);
    });
  });

  // ── unknown type (no featureState) ────────────────────────────────────────

  describe("no featureState — unknown type", () => {
    it("returns [false, undefined] for absent key", () => {
      writeFileSync(yamlFile, "flagValues:\n  other: 1\n");
      const i = new LocalYamlValueInterceptor(yamlFile);
      expect(i.matched("missing", repo)).toEqual([false, undefined]);
    });

    it("returns boolean true", () => {
      writeFileSync(yamlFile, "flagValues:\n  flag: true\n");
      const i = new LocalYamlValueInterceptor(yamlFile);
      expect(i.matched("flag", repo)).toEqual([true, true]);
    });

    it("returns boolean false", () => {
      writeFileSync(yamlFile, "flagValues:\n  flag: false\n");
      const i = new LocalYamlValueInterceptor(yamlFile);
      expect(i.matched("flag", repo)).toEqual([true, false]);
    });

    it("returns integer number", () => {
      writeFileSync(yamlFile, "flagValues:\n  count: 42\n");
      const i = new LocalYamlValueInterceptor(yamlFile);
      expect(i.matched("count", repo)).toEqual([true, 42]);
    });

    it("returns float number", () => {
      writeFileSync(yamlFile, "flagValues:\n  ratio: 3.14\n");
      const i = new LocalYamlValueInterceptor(yamlFile);
      expect(i.matched("ratio", repo)).toEqual([true, 3.14]);
    });

    it("returns string value", () => {
      writeFileSync(yamlFile, 'flagValues:\n  name: "hello world"\n');
      const i = new LocalYamlValueInterceptor(yamlFile);
      expect(i.matched("name", repo)).toEqual([true, "hello world"]);
    });

    it("returns [true, undefined] for explicit null", () => {
      writeFileSync(yamlFile, "flagValues:\n  flag: null\n");
      const i = new LocalYamlValueInterceptor(yamlFile);
      expect(i.matched("flag", repo)).toEqual([true, undefined]);
    });

    it("serialises a nested object to a JSON string", () => {
      writeFileSync(yamlFile, "flagValues:\n  cfg:\n    a: 1\n    b: true\n");
      const i = new LocalYamlValueInterceptor(yamlFile);
      const [matched, value] = i.matched("cfg", repo);
      expect(matched).toBe(true);
      expect(JSON.parse(value as string)).toEqual({ a: 1, b: true });
    });

    it("serialises an array to a JSON string", () => {
      writeFileSync(yamlFile, "flagValues:\n  tags:\n    - alpha\n    - beta\n");
      const i = new LocalYamlValueInterceptor(yamlFile);
      const [matched, value] = i.matched("tags", repo);
      expect(matched).toBe(true);
      expect(JSON.parse(value as string)).toEqual(["alpha", "beta"]);
    });
  });

  // ── BOOLEAN type ──────────────────────────────────────────────────────────

  describe("BOOLEAN featureState", () => {
    const fsBool = fs(FeatureValueType.Boolean);

    it("returns false when yaml value is null", () => {
      writeFileSync(yamlFile, "flagValues:\n  flag: null\n");
      const i = new LocalYamlValueInterceptor(yamlFile);
      expect(i.matched("flag", repo, fsBool)).toEqual([true, false]);
    });

    it("returns true for yaml boolean true", () => {
      writeFileSync(yamlFile, "flagValues:\n  flag: true\n");
      const i = new LocalYamlValueInterceptor(yamlFile);
      expect(i.matched("flag", repo, fsBool)).toEqual([true, true]);
    });

    it("returns false for yaml boolean false", () => {
      writeFileSync(yamlFile, "flagValues:\n  flag: false\n");
      const i = new LocalYamlValueInterceptor(yamlFile);
      expect(i.matched("flag", repo, fsBool)).toEqual([true, false]);
    });

    it('returns true for string "true"', () => {
      writeFileSync(yamlFile, 'flagValues:\n  flag: "true"\n');
      const i = new LocalYamlValueInterceptor(yamlFile);
      expect(i.matched("flag", repo, fsBool)).toEqual([true, true]);
    });

    it('returns true for string "TRUE" (case-insensitive)', () => {
      writeFileSync(yamlFile, 'flagValues:\n  flag: "TRUE"\n');
      const i = new LocalYamlValueInterceptor(yamlFile);
      expect(i.matched("flag", repo, fsBool)).toEqual([true, true]);
    });

    it('returns false for string "false"', () => {
      writeFileSync(yamlFile, 'flagValues:\n  flag: "false"\n');
      const i = new LocalYamlValueInterceptor(yamlFile);
      expect(i.matched("flag", repo, fsBool)).toEqual([true, false]);
    });

    it("returns false for numeric 0 (not the string 'true')", () => {
      writeFileSync(yamlFile, "flagValues:\n  flag: 0\n");
      const i = new LocalYamlValueInterceptor(yamlFile);
      expect(i.matched("flag", repo, fsBool)).toEqual([true, false]);
    });

    it("returns false for numeric 1 (not the string 'true')", () => {
      writeFileSync(yamlFile, "flagValues:\n  flag: 1\n");
      const i = new LocalYamlValueInterceptor(yamlFile);
      expect(i.matched("flag", repo, fsBool)).toEqual([true, false]);
    });
  });

  // ── NUMBER type ───────────────────────────────────────────────────────────

  describe("NUMBER featureState", () => {
    const fsNum = fs(FeatureValueType.Number);

    it("returns null (undefined) for yaml null", () => {
      writeFileSync(yamlFile, "flagValues:\n  n: null\n");
      const i = new LocalYamlValueInterceptor(yamlFile);
      expect(i.matched("n", repo, fsNum)).toEqual([true, undefined]);
    });

    it("returns an integer as-is", () => {
      writeFileSync(yamlFile, "flagValues:\n  n: 7\n");
      const i = new LocalYamlValueInterceptor(yamlFile);
      expect(i.matched("n", repo, fsNum)).toEqual([true, 7]);
    });

    it("returns a float as-is", () => {
      writeFileSync(yamlFile, "flagValues:\n  n: 2.718\n");
      const i = new LocalYamlValueInterceptor(yamlFile);
      expect(i.matched("n", repo, fsNum)).toEqual([true, 2.718]);
    });

    it('converts a numeric string "99" to 99', () => {
      writeFileSync(yamlFile, 'flagValues:\n  n: "99"\n');
      const i = new LocalYamlValueInterceptor(yamlFile);
      expect(i.matched("n", repo, fsNum)).toEqual([true, 99]);
    });

    it("returns undefined for a non-numeric string", () => {
      writeFileSync(yamlFile, 'flagValues:\n  n: "hello"\n');
      const i = new LocalYamlValueInterceptor(yamlFile);
      expect(i.matched("n", repo, fsNum)).toEqual([true, undefined]);
    });

    it("returns undefined for an object value", () => {
      writeFileSync(yamlFile, "flagValues:\n  n:\n    x: 1\n");
      const i = new LocalYamlValueInterceptor(yamlFile);
      expect(i.matched("n", repo, fsNum)).toEqual([true, undefined]);
    });
  });

  // ── STRING type ───────────────────────────────────────────────────────────

  describe("STRING featureState", () => {
    const fsStr = fs(FeatureValueType.String);

    it("returns null (undefined) for yaml null", () => {
      writeFileSync(yamlFile, "flagValues:\n  s: null\n");
      const i = new LocalYamlValueInterceptor(yamlFile);
      expect(i.matched("s", repo, fsStr)).toEqual([true, undefined]);
    });

    it("returns a string value as-is", () => {
      writeFileSync(yamlFile, 'flagValues:\n  s: "hello"\n');
      const i = new LocalYamlValueInterceptor(yamlFile);
      expect(i.matched("s", repo, fsStr)).toEqual([true, "hello"]);
    });

    it("converts a number to string", () => {
      writeFileSync(yamlFile, "flagValues:\n  s: 123\n");
      const i = new LocalYamlValueInterceptor(yamlFile);
      expect(i.matched("s", repo, fsStr)).toEqual([true, "123"]);
    });

    it("converts boolean true to string", () => {
      writeFileSync(yamlFile, "flagValues:\n  s: true\n");
      const i = new LocalYamlValueInterceptor(yamlFile);
      expect(i.matched("s", repo, fsStr)).toEqual([true, "true"]);
    });

    it("returns undefined for an object value", () => {
      writeFileSync(yamlFile, "flagValues:\n  s:\n    key: val\n");
      const i = new LocalYamlValueInterceptor(yamlFile);
      expect(i.matched("s", repo, fsStr)).toEqual([true, undefined]);
    });
  });

  // ── JSON type ─────────────────────────────────────────────────────────────

  describe("JSON featureState", () => {
    const fsJson = fs(FeatureValueType.Json);

    it("returns null (undefined) for yaml null", () => {
      writeFileSync(yamlFile, "flagValues:\n  j: null\n");
      const i = new LocalYamlValueInterceptor(yamlFile);
      expect(i.matched("j", repo, fsJson)).toEqual([true, undefined]);
    });

    it("serialises an object to a JSON string", () => {
      writeFileSync(yamlFile, "flagValues:\n  j:\n    x: 1\n    y: two\n");
      const i = new LocalYamlValueInterceptor(yamlFile);
      const [matched, value] = i.matched("j", repo, fsJson);
      expect(matched).toBe(true);
      expect(JSON.parse(value as string)).toEqual({ x: 1, y: "two" });
    });

    it("serialises an array to a JSON string", () => {
      writeFileSync(yamlFile, "flagValues:\n  j:\n    - 1\n    - 2\n");
      const i = new LocalYamlValueInterceptor(yamlFile);
      const [matched, value] = i.matched("j", repo, fsJson);
      expect(matched).toBe(true);
      expect(JSON.parse(value as string)).toEqual([1, 2]);
    });

    it("returns a pre-serialised JSON string as-is", () => {
      writeFileSync(yamlFile, "flagValues:\n  j: '{\"a\":1}'\n");
      const i = new LocalYamlValueInterceptor(yamlFile);
      expect(i.matched("j", repo, fsJson)).toEqual([true, '{"a":1}']);
    });

    it("serialises a scalar number to its JSON representation", () => {
      writeFileSync(yamlFile, "flagValues:\n  j: 42\n");
      const i = new LocalYamlValueInterceptor(yamlFile);
      expect(i.matched("j", repo, fsJson)).toEqual([true, "42"]);
    });
  });

  // ── close() ───────────────────────────────────────────────────────────────

  describe("close()", () => {
    it("is a no-op when watch is disabled", () => {
      writeFileSync(yamlFile, "flagValues:\n  flag: true\n");
      const i = new LocalYamlValueInterceptor(yamlFile);
      expect(() => i.close()).not.toThrow();
    });

    it("is safe to call multiple times without watching", () => {
      writeFileSync(yamlFile, "flagValues:\n  flag: true\n");
      const i = new LocalYamlValueInterceptor(yamlFile);
      expect(() => {
        i.close();
        i.close();
      }).not.toThrow();
    });

    it("is safe to call multiple times with watching", () => {
      writeFileSync(yamlFile, "flagValues:\n  flag: true\n");
      const i = new LocalYamlValueInterceptor(yamlFile, { watchForChanges: true });
      expect(() => {
        i.close();
        i.close();
      }).not.toThrow();
    });

    it("does not throw when watching a nonexistent file", () => {
      expect(() => {
        const i = new LocalYamlValueInterceptor("/nonexistent/featurehub.yaml", {
          watchForChanges: true,
        });
        i.close();
      }).not.toThrow();
    });
  });

  // ── file watching ─────────────────────────────────────────────────────────

  describe("file watching", () => {
    it("does not reload when watch is disabled", async () => {
      writeFileSync(yamlFile, "flagValues:\n  flag: true\n");
      const i = new LocalYamlValueInterceptor(yamlFile);
      writeFileSync(yamlFile, "flagValues:\n  flag: false\n");
      await sleep(WATCH_SETTLE_MS);
      expect(i.matched("flag", repo)).toEqual([true, true]);
    });

    it("reloads when the file changes", async () => {
      writeFileSync(yamlFile, "flagValues:\n  flag: true\n");
      const i = new LocalYamlValueInterceptor(yamlFile, { watchForChanges: true });
      expect(i.matched("flag", repo)).toEqual([true, true]);

      writeFileSync(yamlFile, "flagValues:\n  flag: false\n");
      await sleep(WATCH_SETTLE_MS);

      expect(i.matched("flag", repo)).toEqual([true, false]);
      i.close();
    });

    it("picks up newly added keys after a file change", async () => {
      writeFileSync(yamlFile, "flagValues:\n  existing: 1\n");
      const i = new LocalYamlValueInterceptor(yamlFile, { watchForChanges: true });
      expect(i.matched("newKey", repo)).toEqual([false, undefined]);

      writeFileSync(yamlFile, "flagValues:\n  existing: 1\n  newKey: 42\n");
      await sleep(WATCH_SETTLE_MS);

      expect(i.matched("newKey", repo)).toEqual([true, 42]);
      i.close();
    });

    it("reflects removed keys after a file change", async () => {
      writeFileSync(yamlFile, "flagValues:\n  gone: true\n  kept: 99\n");
      const i = new LocalYamlValueInterceptor(yamlFile, { watchForChanges: true });
      expect(i.matched("gone", repo)).toEqual([true, true]);

      writeFileSync(yamlFile, "flagValues:\n  kept: 99\n");
      await sleep(WATCH_SETTLE_MS);

      expect(i.matched("gone", repo)).toEqual([false, undefined]);
      expect(i.matched("kept", repo)).toEqual([true, 99]);
      i.close();
    });

    it("stops reloading after close()", async () => {
      writeFileSync(yamlFile, "flagValues:\n  flag: true\n");
      const i = new LocalYamlValueInterceptor(yamlFile, { watchForChanges: true });
      i.close();

      writeFileSync(yamlFile, "flagValues:\n  flag: false\n");
      await sleep(WATCH_SETTLE_MS);

      expect(i.matched("flag", repo)).toEqual([true, true]);
    });
  });
});

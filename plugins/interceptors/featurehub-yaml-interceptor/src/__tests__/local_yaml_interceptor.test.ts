import { unlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { Substitute } from "@fluffy-spoon/substitute";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { FeatureHubRepository } from "featurehub-javascript-core-sdk";

import { LocalYamlValueInterceptor } from "../index";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Must exceed POLL_INTERVAL_MS (500 ms) so the watchFile poll fires at least once
const WATCH_SETTLE_MS = 700;

describe("LocalYamlValueInterceptor", () => {
  let yamlFile: string;
  let repo: FeatureHubRepository;

  beforeEach(() => {
    yamlFile = join(tmpdir(), `featurehub-test-${Date.now()}.yaml`);
    repo = Substitute.for<FeatureHubRepository>();
  });

  afterEach(() => {
    try {
      unlinkSync(yamlFile);
    } catch {
      // file may not have been created in some tests
    }
    delete process.env["FEATUREHUB_LOCAL_YAML"];
  });

  // ─── Static load (no watching) ───────────────────────────────────────────

  it("returns [false, undefined] for a key not in flagValues", () => {
    writeFileSync(yamlFile, "flagValues:\n  banana: true\n");
    process.env["FEATUREHUB_LOCAL_YAML"] = yamlFile;
    const interceptor = new LocalYamlValueInterceptor();
    expect(interceptor.matched("nonexistent", repo)).toEqual([false, undefined]);
  });

  it("returns boolean true", () => {
    writeFileSync(yamlFile, "flagValues:\n  banana: true\n");
    process.env["FEATUREHUB_LOCAL_YAML"] = yamlFile;
    const interceptor = new LocalYamlValueInterceptor();
    expect(interceptor.matched("banana", repo)).toEqual([true, true]);
  });

  it("returns boolean false", () => {
    writeFileSync(yamlFile, "flagValues:\n  banana: false\n");
    process.env["FEATUREHUB_LOCAL_YAML"] = yamlFile;
    const interceptor = new LocalYamlValueInterceptor();
    expect(interceptor.matched("banana", repo)).toEqual([true, false]);
  });

  it("returns integer number", () => {
    writeFileSync(yamlFile, "flagValues:\n  count: 42\n");
    process.env["FEATUREHUB_LOCAL_YAML"] = yamlFile;
    const interceptor = new LocalYamlValueInterceptor();
    expect(interceptor.matched("count", repo)).toEqual([true, 42]);
  });

  it("returns float number", () => {
    writeFileSync(yamlFile, "flagValues:\n  ratio: 3.14\n");
    process.env["FEATUREHUB_LOCAL_YAML"] = yamlFile;
    const interceptor = new LocalYamlValueInterceptor();
    expect(interceptor.matched("ratio", repo)).toEqual([true, 3.14]);
  });

  it("returns string value", () => {
    writeFileSync(yamlFile, 'flagValues:\n  name: "hello world"\n');
    process.env["FEATUREHUB_LOCAL_YAML"] = yamlFile;
    const interceptor = new LocalYamlValueInterceptor();
    expect(interceptor.matched("name", repo)).toEqual([true, "hello world"]);
  });

  it("returns JSON string for nested object", () => {
    writeFileSync(yamlFile, "flagValues:\n  config:\n    key: value\n    nested: true\n");
    process.env["FEATUREHUB_LOCAL_YAML"] = yamlFile;
    const interceptor = new LocalYamlValueInterceptor();
    const [matched, value] = interceptor.matched("config", repo);
    expect(matched).toBe(true);
    expect(JSON.parse(value as string)).toEqual({ key: "value", nested: true });
  });

  it("returns JSON string for array value", () => {
    writeFileSync(yamlFile, "flagValues:\n  tags:\n    - alpha\n    - beta\n");
    process.env["FEATUREHUB_LOCAL_YAML"] = yamlFile;
    const interceptor = new LocalYamlValueInterceptor();
    const [matched, value] = interceptor.matched("tags", repo);
    expect(matched).toBe(true);
    expect(JSON.parse(value as string)).toEqual(["alpha", "beta"]);
  });

  it("returns [true, undefined] for an explicit null value", () => {
    writeFileSync(yamlFile, "flagValues:\n  emptyFlag: null\n");
    process.env["FEATUREHUB_LOCAL_YAML"] = yamlFile;
    const interceptor = new LocalYamlValueInterceptor();
    expect(interceptor.matched("emptyFlag", repo)).toEqual([true, undefined]);
  });

  it("returns empty map and [false, undefined] when file does not exist", () => {
    process.env["FEATUREHUB_LOCAL_YAML"] = "/nonexistent/path/featurehub.yaml";
    const interceptor = new LocalYamlValueInterceptor();
    expect(interceptor.matched("anything", repo)).toEqual([false, undefined]);
  });

  it("uses FEATUREHUB_LOCAL_YAML env var to locate the file", () => {
    writeFileSync(yamlFile, "flagValues:\n  myFlag: true\n");
    process.env["FEATUREHUB_LOCAL_YAML"] = yamlFile;
    const interceptor = new LocalYamlValueInterceptor();
    expect(interceptor.matched("myFlag", repo)).toEqual([true, true]);
  });

  it("handles empty flagValues gracefully", () => {
    writeFileSync(yamlFile, "flagValues: {}\n");
    process.env["FEATUREHUB_LOCAL_YAML"] = yamlFile;
    const interceptor = new LocalYamlValueInterceptor();
    expect(interceptor.matched("anything", repo)).toEqual([false, undefined]);
  });

  it("handles yaml file with no flagValues key", () => {
    writeFileSync(yamlFile, "otherKey: someValue\n");
    process.env["FEATUREHUB_LOCAL_YAML"] = yamlFile;
    const interceptor = new LocalYamlValueInterceptor();
    expect(interceptor.matched("anything", repo)).toEqual([false, undefined]);
  });

  // ─── close() without watching ─────────────────────────────────────────────

  it("close() is a no-op when watch is disabled", () => {
    writeFileSync(yamlFile, "flagValues:\n  myFlag: true\n");
    process.env["FEATUREHUB_LOCAL_YAML"] = yamlFile;
    const interceptor = new LocalYamlValueInterceptor();
    expect(() => interceptor.close()).not.toThrow();
  });

  it("close() is safe to call multiple times without watching", () => {
    writeFileSync(yamlFile, "flagValues:\n  myFlag: true\n");
    process.env["FEATUREHUB_LOCAL_YAML"] = yamlFile;
    const interceptor = new LocalYamlValueInterceptor();
    expect(() => {
      interceptor.close();
      interceptor.close();
    }).not.toThrow();
  });

  it("does not reload file when watch is disabled (default)", async () => {
    writeFileSync(yamlFile, "flagValues:\n  myFlag: true\n");
    process.env["FEATUREHUB_LOCAL_YAML"] = yamlFile;
    const interceptor = new LocalYamlValueInterceptor();

    writeFileSync(yamlFile, "flagValues:\n  myFlag: false\n");
    await sleep(WATCH_SETTLE_MS);

    // without watching, values stay as initially loaded
    expect(interceptor.matched("myFlag", repo)).toEqual([true, true]);
  });

  // ─── File watching ────────────────────────────────────────────────────────

  it("reloads flagValues when the file changes and watch is enabled", async () => {
    writeFileSync(yamlFile, "flagValues:\n  myFlag: true\n");
    process.env["FEATUREHUB_LOCAL_YAML"] = yamlFile;
    const interceptor = new LocalYamlValueInterceptor(true);

    expect(interceptor.matched("myFlag", repo)).toEqual([true, true]);

    writeFileSync(yamlFile, "flagValues:\n  myFlag: false\n");
    await sleep(WATCH_SETTLE_MS);

    expect(interceptor.matched("myFlag", repo)).toEqual([true, false]);
    interceptor.close();
  });

  it("picks up newly added keys after a file change", async () => {
    writeFileSync(yamlFile, "flagValues:\n  existing: 1\n");
    process.env["FEATUREHUB_LOCAL_YAML"] = yamlFile;
    const interceptor = new LocalYamlValueInterceptor(true);

    expect(interceptor.matched("newKey", repo)).toEqual([false, undefined]);

    writeFileSync(yamlFile, "flagValues:\n  existing: 1\n  newKey: 42\n");
    await sleep(WATCH_SETTLE_MS);

    expect(interceptor.matched("newKey", repo)).toEqual([true, 42]);
    interceptor.close();
  });

  it("reflects removed keys after a file change", async () => {
    writeFileSync(yamlFile, "flagValues:\n  gone: true\n  kept: 99\n");
    process.env["FEATUREHUB_LOCAL_YAML"] = yamlFile;
    const interceptor = new LocalYamlValueInterceptor(true);

    expect(interceptor.matched("gone", repo)).toEqual([true, true]);

    writeFileSync(yamlFile, "flagValues:\n  kept: 99\n");
    await sleep(WATCH_SETTLE_MS);

    expect(interceptor.matched("gone", repo)).toEqual([false, undefined]);
    expect(interceptor.matched("kept", repo)).toEqual([true, 99]);
    interceptor.close();
  });

  it("does not update values after close()", async () => {
    writeFileSync(yamlFile, "flagValues:\n  myFlag: true\n");
    process.env["FEATUREHUB_LOCAL_YAML"] = yamlFile;
    const interceptor = new LocalYamlValueInterceptor(true);

    interceptor.close();

    writeFileSync(yamlFile, "flagValues:\n  myFlag: false\n");
    await sleep(WATCH_SETTLE_MS);

    // watcher was stopped before the change, so values must not have updated
    expect(interceptor.matched("myFlag", repo)).toEqual([true, true]);
  });

  it("close() is safe to call multiple times with watching enabled", () => {
    writeFileSync(yamlFile, "flagValues:\n  myFlag: true\n");
    process.env["FEATUREHUB_LOCAL_YAML"] = yamlFile;
    const interceptor = new LocalYamlValueInterceptor(true);
    expect(() => {
      interceptor.close();
      interceptor.close();
    }).not.toThrow();
  });

  it("does not throw when watching a nonexistent file", () => {
    process.env["FEATUREHUB_LOCAL_YAML"] = "/nonexistent/path/featurehub.yaml";
    expect(() => {
      const interceptor = new LocalYamlValueInterceptor(true);
      interceptor.close();
    }).not.toThrow();
  });
});

import { unlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { Substitute } from "@fluffy-spoon/substitute";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { FeatureHubRepository } from "featurehub-javascript-core-sdk";

import { LocalYamlValueInterceptor } from "../index";

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
});

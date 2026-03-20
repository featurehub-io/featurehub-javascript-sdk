import { readFileSync } from "fs";

import { load } from "js-yaml";

import type {
  FeatureState,
  FeatureValueInterceptor,
  FeatureHubRepository,
} from "featurehub-javascript-core-sdk";

const DEFAULT_YAML_FILE = "featurehub-features.yaml";

export class LocalYamlValueInterceptor implements FeatureValueInterceptor {
  private readonly _flagValues: Record<string, unknown>;

  constructor() {
    const yamlFile = process.env["FEATUREHUB_LOCAL_YAML"] ?? DEFAULT_YAML_FILE;
    this._flagValues = LocalYamlValueInterceptor._loadYamlFile(yamlFile);
  }

  private static _loadYamlFile(filePath: string): Record<string, unknown> {
    try {
      const content = readFileSync(filePath, "utf-8");
      const parsed = load(content) as { flagValues?: Record<string, unknown> } | null;
      return parsed?.flagValues ?? {};
    } catch {
      return {};
    }
  }

  matched(
    key: string,
    _repo: FeatureHubRepository,
    _featureState?: FeatureState,
  ): [boolean, string | boolean | number | undefined] {
    if (!Object.hasOwn(this._flagValues, key)) {
      return [false, undefined];
    }

    const value = this._flagValues[key];

    if (value === null || value === undefined) {
      return [true, undefined];
    }

    if (typeof value === "boolean") {
      return [true, value];
    }

    if (typeof value === "number") {
      return [true, value];
    }

    if (typeof value === "string") {
      return [true, value];
    }

    // complex object or array -> JSON string
    return [true, JSON.stringify(value)];
  }
}

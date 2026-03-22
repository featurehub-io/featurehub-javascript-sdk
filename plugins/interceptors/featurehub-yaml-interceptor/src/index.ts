import { readFileSync, unwatchFile, watchFile } from "fs";

import { load } from "js-yaml";

import type {
  FeatureHubRepository,
  FeatureState,
  FeatureValueInterceptor,
} from "featurehub-javascript-core-sdk";

const DEFAULT_YAML_FILE = "featurehub-features.yaml";

/**
 * How often to poll the YAML file for changes when `watchForChanges` is enabled.
 * This is a development-time tool so a 500 ms interval is well within acceptable overhead.
 */
const POLL_INTERVAL_MS = 500;

export class LocalYamlValueInterceptor implements FeatureValueInterceptor {
  private _flagValues: Record<string, unknown>;
  private readonly _filePath: string;
  private _watching = false;
  private readonly _watchListener: () => void;

  constructor(watchForChanges: boolean = false) {
    this._filePath = process.env["FEATUREHUB_LOCAL_YAML"] ?? DEFAULT_YAML_FILE;
    this._flagValues = LocalYamlValueInterceptor._loadYamlFile(this._filePath);

    this._watchListener = () => {
      this._flagValues = LocalYamlValueInterceptor._loadYamlFile(this._filePath);
    };

    if (watchForChanges) {
      this._startWatching();
    }
  }

  private _startWatching(): void {
    watchFile(
      this._filePath,
      { interval: POLL_INTERVAL_MS, persistent: false },
      this._watchListener,
    );
    this._watching = true;
  }

  public close(): void {
    if (this._watching) {
      unwatchFile(this._filePath, this._watchListener);
      this._watching = false;
    }
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

    if (typeof value === "boolean") return [true, value];
    if (typeof value === "number") return [true, value];
    if (typeof value === "string") return [true, value];

    // complex object or array -> JSON string
    return [true, JSON.stringify(value)];
  }
}

import {
  type FeatureHubRepository,
  type FeatureState,
  type FeatureValueInterceptor,
  FeatureValueType,
} from "featurehub-javascript-core-sdk";
import { readFileSync, unwatchFile, watchFile } from "fs";
import { load } from "js-yaml";

const DEFAULT_YAML_FILE = "featurehub-features.yaml";

/**
 * How often to poll the YAML file for changes when `watchForChanges` is enabled.
 * This is a development-time tool so a 500 ms interval is well within acceptable overhead.
 */
const POLL_INTERVAL_MS = 500;

export interface LocalYamlInterceptorOptions {
  watchForChanges?: boolean;
}

export class LocalYamlValueInterceptor implements FeatureValueInterceptor {
  private _flagValues: Record<string, unknown>;
  private readonly _filePath: string;
  private _watching = false;
  private readonly _watchListener: () => void;

  constructor(filename?: string | null, options?: Partial<LocalYamlInterceptorOptions>) {
    this._filePath = filename ?? process.env["FEATUREHUB_LOCAL_YAML"] ?? DEFAULT_YAML_FILE;
    this._flagValues = LocalYamlValueInterceptor._loadYamlFile(this._filePath);

    this._watchListener = () => {
      this._flagValues = LocalYamlValueInterceptor._loadYamlFile(this._filePath);
    };

    if (options?.watchForChanges) {
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

  close(): void {
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
    featureState?: FeatureState,
  ): [boolean, string | boolean | number | undefined] {
    if (!Object.hasOwn(this._flagValues, key)) {
      return [false, undefined];
    }

    const value = this._flagValues[key];
    const type = featureState?.type;

    // ── BOOLEAN ──────────────────────────────────────────────────────────────
    if (type === FeatureValueType.Boolean) {
      if (value === null || value === undefined) return [true, false];
      if (typeof value === "boolean") return [true, value];
      return [true, String(value).toLowerCase() === "true"];
    }

    // For all non-boolean types: null/undefined in the YAML means no value
    if (value === null || value === undefined) return [true, undefined];

    // ── NUMBER ────────────────────────────────────────────────────────────────
    if (type === FeatureValueType.Number) {
      if (typeof value === "number") return [true, value];
      if (typeof value === "string") {
        const n = Number(value);
        if (!isNaN(n)) return [true, n];
      }
      return [true, undefined];
    }

    // ── STRING ────────────────────────────────────────────────────────────────
    if (type === FeatureValueType.String) {
      if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        return [true, String(value)];
      }
      return [true, undefined];
    }

    // ── JSON ──────────────────────────────────────────────────────────────────
    if (type === FeatureValueType.Json) {
      try {
        return [true, typeof value === "string" ? value : JSON.stringify(value)];
      } catch {
        return [true, undefined];
      }
    }

    // ── Unknown type (no featureState / no type) ──────────────────────────────
    if (typeof value === "boolean") return [true, value];
    if (typeof value === "number") return [true, value];
    if (typeof value === "string") return [true, value];
    return [true, JSON.stringify(value)];
  }
}

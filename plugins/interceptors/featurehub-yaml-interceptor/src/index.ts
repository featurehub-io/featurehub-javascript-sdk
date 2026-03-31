import { createHash } from "crypto";
import {
  type FeatureHubConfig,
  type FeatureHubRepository,
  type FeatureState,
  type FeatureValueInterceptor,
  FeatureValueType,
  type InternalFeatureRepository,
  SSEResultState,
} from "featurehub-javascript-core-sdk";
import { readFileSync, unwatchFile, watchFile } from "fs";
import { load } from "js-yaml";

const DEFAULT_YAML_FILE = "featurehub-features.yaml";

/**
 * How often to poll the YAML file for changes when `watchForChanges` is enabled.
 * This is a development-time tool so a 500 ms interval is well within acceptable overhead.
 */
const POLL_INTERVAL_MS = 500;

const LOCAL_YAML_STORE_SOURCE = "local-yaml-store";

// ── Shared helpers ────────────────────────────────────────────────────────────

function loadFlagValues(filePath: string): Record<string, unknown> {
  try {
    const content = readFileSync(filePath, "utf-8");
    const parsed = load(content) as { flagValues?: Record<string, unknown> } | null;
    return parsed?.flagValues ?? {};
  } catch {
    return {};
  }
}

function shortSha256(key: string): string {
  return createHash("sha256").update(key).digest("hex").substring(0, 8);
}

function detectFeatureValueType(value: unknown): FeatureValueType {
  if (typeof value === "boolean") return FeatureValueType.Boolean;
  if (value === null || value === undefined) return FeatureValueType.String;
  if (typeof value === "string") {
    const lower = value.toLowerCase();
    if (lower === "true" || lower === "false") return FeatureValueType.Boolean;
    return FeatureValueType.String;
  }
  if (typeof value === "number") return FeatureValueType.Number;
  // object, array, or any other non-scalar
  return FeatureValueType.Json;
}

function prepareFeatureValue(type: FeatureValueType, value: unknown): unknown {
  if (type === FeatureValueType.Boolean) {
    if (typeof value === "boolean") return value;
    return String(value).toLowerCase() === "true";
  }
  if (type === FeatureValueType.String) {
    if (value === null || value === undefined) return undefined;
    return String(value);
  }
  if (type === FeatureValueType.Number) {
    return value as number;
  }
  // JSON
  try {
    return JSON.stringify(value);
  } catch {
    return undefined;
  }
}

// ── LocalYamlValueInterceptor ─────────────────────────────────────────────────

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
    this._flagValues = loadFlagValues(this._filePath);

    this._watchListener = () => {
      this._flagValues = loadFlagValues(this._filePath);
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

// ── LocalYamlFeatureStore ─────────────────────────────────────────────────────

/**
 * Reads a local YAML file once and populates the FeatureHub repository with the
 * feature values found in it. Intended for development and testing use.
 *
 * The YAML format is identical to that used by {@link LocalYamlValueInterceptor}:
 *
 * ```yaml
 * flagValues:
 *   my-boolean-flag: true
 *   my-string-flag: "hello"
 *   my-number-flag: 42
 *   my-json-flag:
 *     key: value
 * ```
 *
 * Each entry is converted to a {@link FeatureState} whose type is inferred from
 * the YAML value. The feature ID is set to the first 8 hex characters of the
 * SHA-256 hash of the feature key for consistency across runs.
 */
export class LocalYamlFeatureStore {
  private readonly _filePath: string;
  private readonly _config: FeatureHubConfig;

  constructor(config: FeatureHubConfig, filename?: string | null) {
    this._config = config;
    this._filePath = filename ?? process.env["FEATUREHUB_LOCAL_YAML"] ?? DEFAULT_YAML_FILE;
    this._load();
  }

  private _load(): void {
    const flagValues = loadFlagValues(this._filePath);
    const environmentId = this._config.environmentId;

    const features: FeatureState[] = Object.entries(flagValues).map(([key, value]) => {
      const type = detectFeatureValueType(value);
      const preparedValue = prepareFeatureValue(type, value);

      return {
        id: shortSha256(key),
        key,
        l: false,
        version: 1,
        type,
        value: preparedValue,
        environmentId,
      };
    });

    (this._config.repository() as InternalFeatureRepository).notify(
      SSEResultState.Features,
      features,
      LOCAL_YAML_STORE_SOURCE,
    );
  }
}

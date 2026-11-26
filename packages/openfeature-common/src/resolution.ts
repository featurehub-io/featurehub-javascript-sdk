import {
  ErrorCode,
  type FlagMetadata,
  type JsonValue,
  type ResolutionDetails,
  StandardResolutionReasons,
} from "@openfeature/core";
import type { FeatureStateHolder } from "featurehub-javascript-core-sdk";

export type FeatureKind = "boolean" | "string" | "number" | "object";

/** A plain copy of one FeatureHub feature evaluation, safe to pass between async boundaries. */
export interface FeatureEvaluation {
  exists: boolean;
  featureType?: string;
  version?: number;
  value?: unknown;
  /** the strategy that supplied the value: matched locally, or the server's `v` */
  strategyId?: string;
  /** the strategy is a percentage rollout matched locally */
  split?: boolean;
  /** the feature's properties (`fp`) */
  properties?: Record<string, string>;
}

/**
 * Captures one evaluation of a (live) FeatureHub feature state holder. The holder is
 * bound to a shared repository, so callers that resolve against a shared
 * context must capture it while they still hold their lock.
 */
export function captureFeature(holder: FeatureStateHolder | undefined): FeatureEvaluation {
  if (holder === undefined || !holder.exists) {
    return { exists: false };
  }

  // one evaluation gives both the value and the id of the rollout strategy
  // that matched it (see FeatureStateHolder.getValue)
  const evaluated = holder.getValue();

  return {
    exists: true,
    featureType: holder.getType()?.toString(),
    version: holder.getVersion(),
    value: evaluated?.value,
    strategyId: evaluated?.strategyId,
    split: evaluated?.split === true,
    properties: holder.featureProperties,
  };
}

const FEATURE_TYPES: Record<FeatureKind, "BOOLEAN" | "STRING" | "NUMBER" | "JSON"> = {
  boolean: "BOOLEAN",
  string: "STRING",
  number: "NUMBER",
  object: "JSON",
};

export function expectedFeatureType(kind: FeatureKind): "BOOLEAN" | "STRING" | "NUMBER" | "JSON" {
  return FEATURE_TYPES[kind];
}

/**
 * openfeature-resolution.yaml flag_metadata: the feature's properties, then featureVersion and featureType,
 * which replace a property of the same name.
 */
export function buildFlagMetadata(
  featureType: string | undefined,
  version: number | undefined,
  properties?: Record<string, string>,
): FlagMetadata {
  const metadata: FlagMetadata = { ...(properties ?? {}) };
  if (typeof version === "number" && version >= 0) {
    metadata["featureVersion"] = version;
  }
  if (featureType) {
    metadata["featureType"] = featureType;
  }
  return metadata;
}

export function notReadyResolution(defaultValue: unknown): ResolutionDetails<unknown> {
  return {
    value: defaultValue,
    reason: StandardResolutionReasons.ERROR,
    errorCode: ErrorCode.PROVIDER_NOT_READY,
    errorMessage: "FeatureHub provider has not completed initialization.",
  };
}

export function flagNotFoundResolution(
  flagKey: string,
  defaultValue: unknown,
): ResolutionDetails<unknown> {
  return {
    value: defaultValue,
    reason: StandardResolutionReasons.ERROR,
    errorCode: ErrorCode.FLAG_NOT_FOUND,
    errorMessage: `Flag '${flagKey}' was not found in this FeatureHub environment.`,
  };
}

export function invalidContextResolution(
  defaultValue: unknown,
  error: unknown,
): ResolutionDetails<unknown> {
  return {
    value: defaultValue,
    reason: StandardResolutionReasons.ERROR,
    errorCode: ErrorCode.INVALID_CONTEXT,
    errorMessage: error instanceof Error ? error.message : String(error),
  };
}

export function generalErrorResolution(
  defaultValue: unknown,
  error: unknown,
): ResolutionDetails<unknown> {
  return {
    value: defaultValue,
    reason: StandardResolutionReasons.ERROR,
    errorCode: ErrorCode.GENERAL,
    errorMessage: error instanceof Error ? error.message : String(error),
  };
}

// a string that is a number: digits with an optional sign, fraction and exponent (no hex, no whitespace)
const NUMERIC_STRING = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

type Converted = { value: unknown } | { errorCode: ErrorCode; errorMessage: string };

/**
 * openfeature-resolution.yaml resolution.conversion: interceptors (and some sources) supply strings, so
 * strings are converted to the kind asked for. JavaScript's OpenFeature has one number kind, so the
 * integer and double rules are both "a number".
 */
function convert(flagKey: string, kind: FeatureKind, value: unknown): Converted {
  const mismatch = (): Converted => ({
    errorCode: ErrorCode.TYPE_MISMATCH,
    errorMessage: `Flag '${flagKey}' has a value that cannot be resolved as ${kind}.`,
  });

  switch (kind) {
    case "boolean":
      if (typeof value === "boolean") return { value };
      if (value === "true") return { value: true };
      if (value === "false") return { value: false };
      return mismatch();
    case "string":
      if (typeof value === "string") return { value };
      if (typeof value === "number" || typeof value === "boolean") return { value: String(value) };
      return mismatch();
    case "number":
      if (typeof value === "number") return Number.isFinite(value) ? { value } : mismatch();
      if (typeof value === "string" && NUMERIC_STRING.test(value)) {
        const n = Number(value);
        return Number.isFinite(n) ? { value: n } : mismatch();
      }
      return mismatch();
    case "object": {
      let decoded: unknown = value;
      if (typeof value === "string") {
        try {
          decoded = JSON.parse(value) as JsonValue;
        } catch {
          return {
            errorCode: ErrorCode.PARSE_ERROR,
            errorMessage: `Flag '${flagKey}' contains invalid JSON.`,
          };
        }
      }
      // the result must be a JSON object: a list, a number or anything else is a mismatch
      if (typeof decoded === "object" && decoded !== null && !Array.isArray(decoded)) {
        return { value: decoded };
      }
      return mismatch();
    }
  }
}

/**
 * Applies OpenFeature resolution semantics to a captured FeatureHub evaluation (openfeature-resolution.yaml
 * resolution.steps, in order): not found, a feature of the wrong type, no value (DISABLED), conversion,
 * then the reason - STATIC with no strategy, SPLIT for a percentage rollout matched locally,
 * TARGETING_MATCH for any other strategy (the server's `v` included) - with the strategy id as variant.
 *
 * This is the single implementation shared by the Node and Web providers.
 */
export function resolveFromEvaluation(
  flagKey: string,
  kind: FeatureKind,
  defaultValue: unknown,
  evaluation: FeatureEvaluation,
): ResolutionDetails<unknown> {
  if (!evaluation.exists) {
    return flagNotFoundResolution(flagKey, defaultValue);
  }

  const metadata = buildFlagMetadata(
    evaluation.featureType,
    evaluation.version,
    evaluation.properties,
  );

  // checked before the value, so a value-less feature of the wrong type is a TYPE_MISMATCH
  if (evaluation.featureType && evaluation.featureType !== expectedFeatureType(kind)) {
    return {
      value: defaultValue,
      reason: StandardResolutionReasons.ERROR,
      errorCode: ErrorCode.TYPE_MISMATCH,
      errorMessage: `Flag '${flagKey}' is of type ${evaluation.featureType} and cannot be resolved as ${kind}.`,
      flagMetadata: metadata,
    };
  }

  if (evaluation.value === undefined || evaluation.value === null) {
    // the feature, or the strategy or interceptor that supplied the value, has none
    return {
      value: defaultValue,
      reason: StandardResolutionReasons.DISABLED,
      variant: evaluation.strategyId,
      flagMetadata: metadata,
    };
  }

  const converted = convert(flagKey, kind, evaluation.value);
  if (!("value" in converted)) {
    return {
      value: defaultValue,
      reason: StandardResolutionReasons.ERROR,
      errorCode: converted.errorCode,
      errorMessage: converted.errorMessage,
      flagMetadata: metadata,
    };
  }

  return {
    value: converted.value,
    reason: !evaluation.strategyId
      ? StandardResolutionReasons.STATIC
      : evaluation.split
        ? StandardResolutionReasons.SPLIT
        : StandardResolutionReasons.TARGETING_MATCH,
    variant: evaluation.strategyId,
    flagMetadata: metadata,
  };
}

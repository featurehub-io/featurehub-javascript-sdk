import {
  ErrorCode,
  type FlagMetadata,
  type JsonValue,
  type ResolutionDetails,
  StandardResolutionReasons,
} from "@openfeature/core";
import type { FeatureStateHolder } from "featurehub-javascript-core-sdk";

export type FeatureKind = "boolean" | "string" | "number" | "object";

/** A plain snapshot of a FeatureHub feature, safe to pass between async boundaries. */
export interface FeatureSnapshot {
  exists: boolean;
  featureType?: string;
  version?: number;
  value?: unknown;
  strategyId?: string;
}

/**
 * Takes a snapshot of a (live) FeatureHub feature state holder. The holder is
 * bound to a shared repository, so callers that resolve against a shared
 * context must take the snapshot while they still hold their lock.
 */
export function snapshotFeature(holder: FeatureStateHolder | undefined): FeatureSnapshot {
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

export function buildFlagMetadata(
  featureType: string | undefined,
  version: number | undefined,
): FlagMetadata {
  const metadata: FlagMetadata = {};
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

/**
 * Applies OpenFeature resolution semantics to a FeatureHub snapshot:
 * not-found, type mismatch, value-less features, JSON parsing, and the
 * `TARGETING_MATCH` / `STATIC` reason with the matched strategy as `variant`.
 *
 * This is the single implementation shared by the Node and Web providers.
 */
export function resolveFromEvaluation(
  flagKey: string,
  kind: FeatureKind,
  defaultValue: unknown,
  evaluation: FeatureSnapshot,
): ResolutionDetails<unknown> {
  if (!evaluation.exists) {
    return flagNotFoundResolution(flagKey, defaultValue);
  }

  const metadata = buildFlagMetadata(evaluation.featureType, evaluation.version);

  // mismatched feature type (e.g. boolean resolution against a string flag)
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
    // value-less features (strings/numbers/json can be value-less) resolve
    // to the code default
    return {
      value: defaultValue,
      reason: StandardResolutionReasons.DEFAULT,
      flagMetadata: metadata,
    };
  }

  let value: unknown = evaluation.value;
  if (kind === "object" && typeof value === "string") {
    try {
      value = JSON.parse(value) as JsonValue;
    } catch {
      return {
        value: defaultValue,
        reason: StandardResolutionReasons.ERROR,
        errorCode: ErrorCode.PARSE_ERROR,
        errorMessage: `Flag '${flagKey}' contains invalid JSON.`,
        flagMetadata: metadata,
      };
    }
  }

  return {
    value,
    reason: evaluation.strategyId
      ? StandardResolutionReasons.TARGETING_MATCH
      : StandardResolutionReasons.STATIC,
    variant: evaluation.strategyId,
    flagMetadata: metadata,
  };
}

import { type FeatureState, FeatureValueType } from "./models";

/**
 * The features a snapshot server serves for one request, as a snapshot client reads them
 * (feature-snapshot-protocol.yaml encoding.feature_snapshot). The sha is the server's: a client never
 * computes one, and a snapshot without one has none.
 */
export interface FeatureSnapshot {
  sha?: string;
  features: Array<FeatureState>;
}

/** data that is not a feature snapshot; a repository given it is left unchanged */
export class FeatureSnapshotFormatError extends Error {
  constructor(message: string) {
    super(`not a feature snapshot: ${message}`);
    this.name = "FeatureSnapshotFormatError";
  }
}

const FEATURE_TYPES = Object.values(FeatureValueType) as Array<string>;

function decodeFeature(value: unknown, index: number): FeatureState {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new FeatureSnapshotFormatError(`feature ${index} is not an object`);
  }

  const f = value as Record<string, unknown>;
  if (typeof f["id"] !== "string" || typeof f["key"] !== "string") {
    throw new FeatureSnapshotFormatError(`feature ${index} has no id or key`);
  }
  // a version is required: the update rule and change events depend on it, so it is never defaulted
  // (encoding.feature_snapshot.decoding.version_required)
  if (typeof f["version"] !== "number" || !Number.isFinite(f["version"])) {
    throw new FeatureSnapshotFormatError(`feature ${f["key"]} has no version`);
  }
  if (typeof f["type"] !== "string" || !FEATURE_TYPES.includes(f["type"])) {
    throw new FeatureSnapshotFormatError(`feature ${f["key"]} has no valid type`);
  }

  return f as unknown as FeatureState;
}

/**
 * Reads a feature snapshot (feature-snapshot-protocol.yaml encoding.feature_snapshot.decoding) from: a
 * decoded snapshot or an object with a `features` array and an optional `sha`, its JSON text, or a bare array
 * of features. A missing (or non-string) sha leaves the snapshot without one. Anything else throws a
 * FeatureSnapshotFormatError.
 */
export function decodeFeatureSnapshot(data: unknown): FeatureSnapshot {
  let decoded = data;

  if (typeof data === "string") {
    try {
      decoded = JSON.parse(data);
    } catch (_) {
      throw new FeatureSnapshotFormatError("invalid JSON");
    }
  }

  let features: unknown;
  let sha: unknown;

  if (Array.isArray(decoded)) {
    features = decoded;
  } else if (decoded !== null && typeof decoded === "object") {
    features = (decoded as Record<string, unknown>)["features"];
    sha = (decoded as Record<string, unknown>)["sha"];
  } else {
    throw new FeatureSnapshotFormatError(
      "expected an object with features, or an array of features",
    );
  }

  if (!Array.isArray(features)) {
    throw new FeatureSnapshotFormatError("features is missing or not an array");
  }

  const decodedFeatures = features.map((f, i) => decodeFeature(f, i));

  return typeof sha === "string"
    ? { sha, features: decodedFeatures }
    : { features: decodedFeatures };
}

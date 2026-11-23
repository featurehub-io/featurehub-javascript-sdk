import { sha256Hex } from "./crypto/sha256";
import { type FeatureState, FeatureValueType } from "./models";

/**
 * The features a repository holds plus their SHA, as a snapshot server serves them and a snapshot client
 * reads them (feature-snapshot-protocol.yaml encoding.feature_snapshot).
 */
export interface FeatureSnapshot {
  sha: string;
  features: Array<FeatureState>;
}

/** data that is not a feature snapshot; a repository given it is left unchanged */
export class FeatureSnapshotFormatError extends Error {
  constructor(message: string) {
    super(`not a feature snapshot: ${message}`);
    this.name = "FeatureSnapshotFormatError";
  }
}

/**
 * featurehub-protocol.yaml encoding.sha: the features sorted by id (plain string comparison), each as
 * "<id>:<version>", joined with "|", then SHA-256 as 64 lowercase hex characters. It identifies a set of
 * features by their ids and versions only, not their values.
 */
export function featuresSha(features: ReadonlyArray<Pick<FeatureState, "id" | "version">>): string {
  const input = [...features]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((f) => `${f.id}:${Math.trunc(f.version ?? 0)}`)
    .join("|");

  return sha256Hex(input);
}

/** feature-snapshot-protocol.yaml encoding.etag: the SHA in double quotes (a strong entity tag) */
export function featureSnapshotEtag(sha: string): string {
  return `"${sha}"`;
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
  // a version is required: the SHA, the update rule and change events all depend on it, so it is never
  // defaulted (encoding.feature_snapshot.decoding.version_required)
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
 * of features. A missing (or non-string) sha is computed. Anything else throws a FeatureSnapshotFormatError.
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

  return {
    sha: typeof sha === "string" ? sha : featuresSha(decodedFeatures),
    features: decodedFeatures,
  };
}

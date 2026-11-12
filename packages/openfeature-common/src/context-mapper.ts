import type { EvaluationContext } from "@openfeature/core";
import type { ContextAttribute } from "featurehub-javascript-core-sdk";

export type { ContextAttribute } from "featurehub-javascript-core-sdk";

export interface MappedContext {
  /** FeatureHub's user key (OpenFeature `targetingKey`). */
  userkey?: string;
  /** All remaining context attributes, keyed by FeatureHub attribute key. */
  attributes: Record<string, ContextAttribute>;
}

/** Attribute keys FeatureHub treats specially (case-insensitive). */
const FEATURE_HUB_KEYS = new Set([
  "userkey",
  "email",
  "device",
  "platform",
  "version",
  "country",
  "session",
  "sessionkey",
]);

/** Raised when an OpenFeature context contains a value FeatureHub cannot represent. */
export class InvalidContextError extends Error {
  readonly key: string;
  constructor(key: string) {
    super(
      `Context attribute '${key}' is an object or contains nested objects; FeatureHub attributes must be strings, numbers, booleans, or arrays of those.`,
    );
    this.name = "InvalidContextError";
    this.key = key;
  }
}

/** True when the API key is client-evaluated (FeatureHub marks these with a `*`). */
export function isClientEvaluatedKey(apiKey: string): boolean {
  return apiKey.includes("*");
}

function isPrimitive(v: unknown): v is string | number | boolean {
  return typeof v === "string" || typeof v === "number" || typeof v === "boolean";
}

function isAllowedArray(v: unknown): v is Array<string | number | boolean> {
  return Array.isArray(v) && v.every(isPrimitive);
}

/**
 * Maps an OpenFeature EvaluationContext onto FeatureHub's context model.
 *
 * - `targetingKey` maps to FeatureHub's `userkey` (the default percentage key).
 * - `session` / `sessionkey` map to FeatureHub's `sessionkey`.
 * - Well-known FeatureHub keys (`email`, `device`, `platform`, `version`,
 *   `country`) are recognised case-insensitively.
 * - Everything else passes through as a custom attribute.
 *
 * @throws InvalidContextError when a value cannot be represented.
 */
export function mapEvaluationContext(context: EvaluationContext | undefined): MappedContext {
  const attributes: Record<string, ContextAttribute> = {};
  let userkey: string | undefined;

  if (context) {
    for (const [key, value] of Object.entries(context)) {
      if (value === undefined || value === null) {
        continue;
      }
      const lower = key.toLowerCase();
      if (lower === "targetingkey" || lower === "userkey") {
        userkey = String(value);
      } else if (isPrimitive(value)) {
        attributes[FEATURE_HUB_KEYS.has(lower) ? lower : key] = value;
      } else if (isAllowedArray(value)) {
        attributes[FEATURE_HUB_KEYS.has(lower) ? lower : key] = value as ContextAttribute;
      } else {
        throw new InvalidContextError(key);
      }
    }
  }

  return { userkey, attributes };
}

/**
 * Builds a FeatureHub `ContextRecord` (for the SDK's context API) from an
 * OpenFeature EvaluationContext.
 *
 * @param options.sessionAsSessionKey - map `session` to `sessionkey`, as
 * required when the bundle is evaluated server-side (FeatureHub's server
 * percentage key); leave false for client-evaluated keys.
 */
export function toContextRecord(
  context: EvaluationContext | undefined,
  options?: { sessionAsSessionKey?: boolean },
): Record<string, ContextAttribute> {
  const { userkey, attributes } = mapEvaluationContext(context);
  const record = userkey === undefined ? { ...attributes } : { userkey, ...attributes };
  if (options?.sessionAsSessionKey && "session" in record) {
    record["sessionkey"] = record["session"];
    delete record["session"];
  }
  return record;
}

/**
 * A stable signature of a mapped context, used only to detect context changes
 * (it is never sent anywhere, so it deliberately does not reproduce the
 * `x-featurehub` wire format — the SDK builds that from the context itself).
 */
export function contextSignature(context: EvaluationContext | undefined): string {
  const { userkey, attributes } = mapEvaluationContext(context);

  const entries: Array<[string, string]> = Object.entries(attributes).map(([key, value]) => [
    key,
    Array.isArray(value) ? value.join(",") : String(value),
  ]);
  if (userkey !== undefined) {
    entries.push(["userkey", userkey]);
  }

  return JSON.stringify(entries.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)));
}

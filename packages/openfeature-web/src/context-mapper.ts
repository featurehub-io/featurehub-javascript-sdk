import type { EvaluationContext } from "@openfeature/web-sdk";

/**
 * FeatureHub context attributes may be a primitive or an array of primitives.
 * Anything else (objects, arrays of objects) cannot be represented.
 */
export type ContextAttribute =
  | string
  | number
  | boolean
  | Array<string>
  | Array<number>
  | Array<boolean>;

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

function isPrimitive(v: unknown): v is string | number | boolean {
  return typeof v === "string" || typeof v === "number" || typeof v === "boolean";
}

function isAllowedArray(v: unknown): v is Array<string | number | boolean> {
  return Array.isArray(v) && v.every(isPrimitive);
}

/**
 * Maps an OpenFeature EvaluationContext onto FeatureHub's context model.
 * `targetingKey` becomes FeatureHub's `userkey`; `session`/`sessionkey`
 * become FeatureHub's `sessionkey`; well-known FeatureHub keys are recognised
 * case-insensitively; everything else passes through as a custom attribute.
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

/** Builds a FeatureHub `ContextRecord` for the SDK's context API. */
export function toContextRecord(
  context: EvaluationContext | undefined,
): Record<string, ContextAttribute> {
  const { userkey, attributes } = mapEvaluationContext(context);
  return userkey === undefined ? { ...attributes } : { userkey, ...attributes };
}

import type { EvaluationContext } from "@openfeature/core";
import {
  type ContextAttribute,
  StrategyAttributeWellKnownNames,
} from "featurehub-javascript-core-sdk";

/** the strategy-only attribute, compared case-insensitively */
const FHUB_WHEN_ACTIVE = StrategyAttributeWellKnownNames.FhubWhenActive.toLowerCase();

export type { ContextAttribute } from "featurehub-javascript-core-sdk";

export interface MappedContext {
  /** FeatureHub's user key (OpenFeature `targetingKey`). */
  userkey?: string;
  /** All remaining context attributes, keyed by FeatureHub attribute key. */
  attributes: Record<string, ContextAttribute>;
}

/**
 * The well-known attribute keys, recognised case-insensitively and written lowercase: exactly the Edge API's
 * StrategyAttributeWellKnownNames (featurehub-protocol.yaml encoding.evaluation_context), less the user key,
 * which targetingKey supplies, and fhubWhenActive, which is a strategy attribute and never a context key.
 */
const WELL_KNOWN_KEYS = new Set(
  Object.values(StrategyAttributeWellKnownNames)
    .map((k) => k.toLowerCase())
    .filter((k) => k !== "userkey" && k !== FHUB_WHEN_ACTIVE),
);

/** Raised when an OpenFeature context contains a value FeatureHub cannot represent. */
export class InvalidContextError extends Error {
  readonly key: string;
  constructor(key: string) {
    super(
      `Context attribute '${key}' is an object or contains nested objects; FeatureHub attributes must be strings, numbers, booleans, date-times, or lists of those.`,
    );
    this.name = "InvalidContextError";
    this.key = key;
  }
}

/**
 * Raised when a server-evaluated key is asked to resolve a context other than the one it is resolving. Such
 * a key holds one context, evaluated by Edge, for every OpenFeature client in the process: two code paths
 * resolving different contexts at the same time would each be given the other's values.
 */
export class ContextConflictError extends Error {
  constructor() {
    super(
      "A server-evaluated API key holds one evaluation context for the whole process, and a resolution for a " +
        "different context arrived while another context's was in progress. Use the same context everywhere, " +
        "or a client-evaluated key (containing '*') to resolve many contexts at once.",
    );
    this.name = "ContextConflictError";
  }
}

/** True when the API key is client-evaluated (FeatureHub marks these with a `*`). */
export function isClientEvaluatedKey(apiKey: string): boolean {
  return apiKey.includes("*");
}

type ContextValue = string | number | boolean | Date;

function isValue(v: unknown): v is ContextValue {
  return (
    typeof v === "string" || typeof v === "number" || typeof v === "boolean" || v instanceof Date
  );
}

function isAllowedList(v: unknown): v is Array<ContextValue> {
  return Array.isArray(v) && v.every(isValue);
}

/**
 * Maps an OpenFeature EvaluationContext onto FeatureHub's context model
 * (featurehub-protocol.yaml encoding.evaluation_context):
 *
 * - `targetingKey` (or `userkey`) maps to FeatureHub's `userkey`.
 * - The well-known keys (`device`, `country`, `platform`, `session`, `version`) are recognised
 *   case-insensitively and written lowercase.
 * - `fhubWhenActive` is dropped: it is a strategy attribute, never supplied by the application.
 * - Everything else passes through as a custom attribute, its case preserved.
 * - Values are strings, numbers, booleans or date-times (a `Date`), or lists of those; null values are
 *   skipped. A date-time is sent to FeatureHub as UTC ISO-8601 to the second.
 *
 * @throws InvalidContextError when a value cannot be represented (an object, or a list holding one).
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
      } else if (lower === FHUB_WHEN_ACTIVE) {
        continue;
      } else if (isValue(value) || isAllowedList(value)) {
        attributes[WELL_KNOWN_KEYS.has(lower) ? lower : key] = value as ContextAttribute;
      } else {
        throw new InvalidContextError(key);
      }
    }
  }

  return { userkey, attributes };
}

/** Builds a FeatureHub `ContextRecord` (for the SDK's context API) from an OpenFeature EvaluationContext. */
export function toContextRecord(
  context: EvaluationContext | undefined,
): Record<string, ContextAttribute> {
  const { userkey, attributes } = mapEvaluationContext(context);
  return userkey === undefined ? { ...attributes } : { userkey, ...attributes };
}

/**
 * A stable signature of a mapped context, used only to detect context changes
 * (it is never sent anywhere, so it deliberately does not reproduce the
 * `x-featurehub` wire format — the SDK builds that from the context itself).
 */
export function contextSignature(context: EvaluationContext | undefined): string {
  const { userkey, attributes } = mapEvaluationContext(context);

  // JSON keeps the types and the list boundaries: ["a,b"] is not ["a", "b"], nor 1 "1"
  const json = (v: unknown) => (v instanceof Date ? { date: v.toISOString() } : v);
  const entries: Array<[string, unknown]> = Object.entries(attributes).map(([key, value]) => [
    key,
    Array.isArray(value) ? value.map(json) : json(value),
  ]);
  if (userkey !== undefined) {
    entries.push(["userkey", userkey]);
  }

  return JSON.stringify(entries.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)));
}

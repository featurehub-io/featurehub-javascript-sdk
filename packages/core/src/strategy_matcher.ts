import murmurhash from "murmurhash";
import { Netmask } from "netmask";
import compareSemver from "semver-compare";

import { caToString, type ClientContext, contextValueToString, isoSeconds } from "./client_context";
import type { FeatureValue } from "./feature_state";
import {
  type FeatureRolloutStrategy,
  type FeatureRolloutStrategyAttribute,
  RolloutStrategyAttributeConditional,
  RolloutStrategyFieldType,
} from "./models";

export interface PercentageCalculator {
  determineClientPercentage(percentageText: string, featureId: string): number;
}

export class Murmur3PercentageCalculator implements PercentageCalculator {
  private readonly MAX_PERCENTAGE = 1000000;

  public determineClientPercentage(percentageText: string, featureId: string): number {
    const result = murmurhash.v3(percentageText + featureId, 0);
    return Math.floor((result / Math.pow(2, 32)) * this.MAX_PERCENTAGE);
  }
}

export class Applied {
  public readonly matched: boolean;
  public readonly value: FeatureValue;
  public readonly strategyId: string | undefined;
  /** the matching strategy is a percentage rollout (rollout-strategies.yaml inputs.output: split) */
  public readonly split: boolean;

  constructor(
    matched: boolean,
    value: FeatureValue,
    strategyId: string | undefined,
    split = false,
  ) {
    this.matched = matched;
    this.value = value;
    this.strategyId = strategyId;
    this.split = split;
  }
}

export interface StrategyMatcher {
  match(suppliedValue: BaseContextAttribute, attr: FeatureRolloutStrategyAttribute): boolean;
}

export interface MatcherRepository {
  findMatcher(attr: FeatureRolloutStrategyAttribute): StrategyMatcher;
}

type BaseContextAttribute = string | number | boolean | Date;

// @ts-expect-error - This is a fallback matcher
// eslint-disable-next-line @typescript-eslint/no-unused-vars
class FallthroughMatcher implements StrategyMatcher {
  match(_suppliedValue: BaseContextAttribute, _attr: FeatureRolloutStrategyAttribute): boolean {
    return false;
  }
}

class BooleanMatcher implements StrategyMatcher {
  match(comparedValue: BaseContextAttribute, attr: FeatureRolloutStrategyAttribute): boolean {
    const values = (attr.values || [])
      .filter((v) => v != null)
      .map((v) => (typeof v === "boolean" ? v : v.toString() === "true"));

    if (values.length == 0) return false;

    const val =
      typeof comparedValue === "boolean" ? comparedValue : comparedValue.toString() === "true";

    // we only care about the 1st one
    if (attr.conditional === RolloutStrategyAttributeConditional.Equals) {
      return val === values[0];
    }

    if (attr.conditional === RolloutStrategyAttributeConditional.NotEquals) {
      return val !== values[0];
    }

    return false;
  }
}

function stringValues(attrValues: Array<any> | undefined): Array<string> {
  if (attrValues === undefined) return [];

  return (attrValues || []).filter((v) => v != null).map((v) => v.toString());
}

class StringMatcher implements StrategyMatcher {
  match(suppliedValue: string, attr: FeatureRolloutStrategyAttribute): boolean {
    const vals = this.attrToStringValues(attr);

    switch (attr.conditional) {
      case RolloutStrategyAttributeConditional.Equals:
        return vals.findIndex((v) => v === suppliedValue) >= 0;
      case RolloutStrategyAttributeConditional.EndsWith:
        return vals.findIndex((v) => suppliedValue.endsWith(v)) >= 0;
      case RolloutStrategyAttributeConditional.StartsWith:
        return vals.findIndex((v) => suppliedValue.startsWith(v)) >= 0;
      case RolloutStrategyAttributeConditional.Greater:
        return vals.findIndex((v) => suppliedValue > v) >= 0;
      case RolloutStrategyAttributeConditional.GreaterEquals:
        return vals.findIndex((v) => suppliedValue >= v) >= 0;
      case RolloutStrategyAttributeConditional.Less:
        return vals.findIndex((v) => suppliedValue < v) >= 0;
      case RolloutStrategyAttributeConditional.LessEquals:
        return vals.findIndex((v) => suppliedValue <= v) >= 0;
      case RolloutStrategyAttributeConditional.NotEquals:
        return vals.findIndex((v) => v === suppliedValue) === -1;
      case RolloutStrategyAttributeConditional.Includes:
        return vals.findIndex((v) => suppliedValue.includes(v)) >= 0;
      case RolloutStrategyAttributeConditional.Excludes:
        return vals.findIndex((v) => suppliedValue.includes(v)) === -1;
      case RolloutStrategyAttributeConditional.Regex:
        return vals.findIndex((v) => suppliedValue.match(v)) >= 0;
    }
  }

  // this is overridden in some descendants
  protected attrToStringValues(attr: FeatureRolloutStrategyAttribute): Array<string> {
    return stringValues(attr.values);
  }
}

// rollout-strategies.yaml matchers.iso_date_time: an ISO-8601 date, or date-time with an optional offset
const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/i;
const HAS_OFFSET = /(Z|[+-]\d{2}:?\d{2})$/i;

/**
 * A date-time, read strictly and always as UTC (rollout-strategies.yaml matchers.iso_date_time): a Date as it
 * is, or a string that is an ISO-8601 date or date-time. A date alone is midnight UTC, and a date-time without
 * an offset is UTC, never the machine's local time (which is how JavaScript's Date would read it). Anything
 * else - a number, "15/06/2020", "2020-06-15 10:00:00Z" - is not a date-time, and gives undefined.
 */
export function parseUtcDateTime(value: unknown): Date | undefined {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? undefined : value;
  }

  if (typeof value !== "string") {
    return undefined;
  }

  let text = value.trim().toUpperCase();
  if (!ISO_DATE_TIME.test(text)) {
    return undefined;
  }

  if (text.includes("T") && !HAS_OFFSET.test(text)) {
    text += "Z";
  }

  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

class DateMatcher extends StringMatcher {
  override match(
    suppliedValue: BaseContextAttribute,
    attr: FeatureRolloutStrategyAttribute,
  ): boolean {
    const parsedDate = parseUtcDateTime(suppliedValue);

    return parsedDate !== undefined && super.match(parsedDate.toISOString().substring(0, 10), attr);
  }

  protected override attrToStringValues(attr: FeatureRolloutStrategyAttribute): Array<string> {
    return (attr.values || [])
      .filter((v) => v != null)
      .map((v) => (v instanceof Date ? v.toISOString().substring(0, 10) : v.toString()));
  }
}

class DateTimeMatcher extends StringMatcher {
  override match(
    suppliedValue: BaseContextAttribute,
    attr: FeatureRolloutStrategyAttribute,
  ): boolean {
    const parsedDate = parseUtcDateTime(suppliedValue);

    return parsedDate !== undefined && super.match(isoSeconds(parsedDate), attr);
  }

  // a value that is an ISO-8601 date or date-time is normalised as the supplied value is (UTC, no offset
  // meaning UTC, whole seconds), so both sides compare to the second; any other value is used as it is
  // (rollout-strategies.yaml matchers.DATETIME)
  protected override attrToStringValues(attr: FeatureRolloutStrategyAttribute): Array<string> {
    return (attr.values || [])
      .filter((v) => v != null)
      .map((v) => {
        const parsed = parseUtcDateTime(v);
        return parsed === undefined ? v.toString() : isoSeconds(parsed);
      });
  }
}

// rollout-strategies.yaml js_conversions.strict_number: a finite number, or a string that is exactly a decimal
// integer or float - no parseInt / parseFloat prefixes, exponents, hex, whitespace or Infinity
const STRICT_NUMBER = /^[+-]?[0-9]+(\.[0-9]+)?$/;

function strictNumber(value: unknown): number | undefined {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }

  if (typeof value === "string" && STRICT_NUMBER.test(value)) {
    return Number(value);
  }

  return undefined;
}

class NumberMatcher implements StrategyMatcher {
  // values that are not numbers are ignored, as null values are (rollout-strategies.yaml matchers.NUMBER)
  private numericValues(attrValues: Array<unknown> | undefined | null): Array<number> {
    return (attrValues ?? [])
      .map((v) => strictNumber(v))
      .filter((v): v is number => v !== undefined);
  }

  match(comparedValue: BaseContextAttribute, attr: FeatureRolloutStrategyAttribute): boolean {
    // a supplied value that is not a number never matches, whatever the conditional
    const supplied = strictNumber(comparedValue);
    if (supplied === undefined) {
      return false;
    }

    const values = this.numericValues(attr.values);
    // the text conditionals compare the supplied number's string form with the number values' (so "100.0"
    // is "100", which STARTS_WITH 1)
    const text = String(supplied);
    const texts = values.map((v) => String(v));

    switch (attr.conditional) {
      case RolloutStrategyAttributeConditional.Equals:
        return values.some((v) => v === supplied);
      case RolloutStrategyAttributeConditional.NotEquals:
        return !values.some((v) => v === supplied);
      case RolloutStrategyAttributeConditional.Greater:
        return values.some((v) => supplied > v);
      case RolloutStrategyAttributeConditional.GreaterEquals:
        return values.some((v) => supplied >= v);
      case RolloutStrategyAttributeConditional.Less:
        return values.some((v) => supplied < v);
      case RolloutStrategyAttributeConditional.LessEquals:
        return values.some((v) => supplied <= v);
      case RolloutStrategyAttributeConditional.Includes:
        return texts.some((v) => text.includes(v));
      case RolloutStrategyAttributeConditional.Excludes:
        return !texts.some((v) => text.includes(v));
      case RolloutStrategyAttributeConditional.StartsWith:
        return texts.some((v) => text.startsWith(v));
      case RolloutStrategyAttributeConditional.EndsWith:
        return texts.some((v) => text.endsWith(v));
      case RolloutStrategyAttributeConditional.Regex:
        return texts.some((v) => {
          try {
            return new RegExp(v).test(text);
          } catch (_) {
            return false;
          }
        });
      default:
        return false;
    }
  }
}

class SemanticVersionMatcher implements StrategyMatcher {
  match(comparedValue: BaseContextAttribute, attr: FeatureRolloutStrategyAttribute): boolean {
    const vals = stringValues(attr.values);
    const suppliedValue = comparedValue.toString();

    switch (attr.conditional) {
      case RolloutStrategyAttributeConditional.Includes:
      case RolloutStrategyAttributeConditional.Equals:
        return vals.findIndex((v) => compareSemver(suppliedValue, v) === 0) >= 0;
      case RolloutStrategyAttributeConditional.EndsWith:
        break;
      case RolloutStrategyAttributeConditional.StartsWith:
        break;
      case RolloutStrategyAttributeConditional.Greater:
        return vals.findIndex((v) => compareSemver(suppliedValue, v) > 0) >= 0;
      case RolloutStrategyAttributeConditional.GreaterEquals:
        return vals.findIndex((v) => compareSemver(suppliedValue, v) >= 0) >= 0;
      case RolloutStrategyAttributeConditional.Less:
        return vals.findIndex((v) => compareSemver(suppliedValue, v) < 0) >= 0;
      case RolloutStrategyAttributeConditional.LessEquals:
        return vals.findIndex((v) => compareSemver(suppliedValue, v) <= 0) >= 0;
      case RolloutStrategyAttributeConditional.NotEquals:
      case RolloutStrategyAttributeConditional.Excludes:
        return vals.findIndex((v) => compareSemver(suppliedValue, v) !== 0) >= 0;
      case RolloutStrategyAttributeConditional.Regex:
        break;
    }

    return false;
  }
}

class IPNetworkMatcher implements StrategyMatcher {
  match(comparedVal: BaseContextAttribute, attr: FeatureRolloutStrategyAttribute): boolean {
    const vals = stringValues(attr.values);
    const ip = comparedVal.toString();

    switch (attr.conditional) {
      case RolloutStrategyAttributeConditional.Equals:
      case RolloutStrategyAttributeConditional.Includes:
        return vals.findIndex((v) => new Netmask(v).contains(ip)) >= 0;
      case RolloutStrategyAttributeConditional.NotEquals:
      case RolloutStrategyAttributeConditional.Excludes:
        return vals.findIndex((v) => new Netmask(v).contains(ip)) === -1;
    }

    return false;
  }
}

export class MatcherRegistry implements MatcherRepository {
  findMatcher(attr: FeatureRolloutStrategyAttribute): StrategyMatcher {
    switch (attr?.type) {
      case RolloutStrategyFieldType.String:
        return new StringMatcher();
      case RolloutStrategyFieldType.SemanticVersion:
        return new SemanticVersionMatcher();
      case RolloutStrategyFieldType.Number:
        return new NumberMatcher();
      case RolloutStrategyFieldType.Date:
        return new DateMatcher();
      case RolloutStrategyFieldType.Datetime:
        return new DateTimeMatcher();
      case RolloutStrategyFieldType.Boolean:
        return new BooleanMatcher();
      case RolloutStrategyFieldType.IpAddress:
        return new IPNetworkMatcher();
    }
  }
}

// date-times are compared in whole seconds since the epoch, never below: any fraction of a second is
// dropped (truncated, not rounded)
function epochSeconds(epochMs: number): number {
  return Math.floor(epochMs / 1000);
}

// an fhubWhenActive value as whole seconds since the epoch: an ISO-8601 date-time (the time part is required),
// with no offset meaning UTC; undefined for anything else (rollout-strategies.yaml fhubWhenActive.value)
function isoEpochSeconds(value: unknown): number | undefined {
  if (typeof value !== "string" || !value.toUpperCase().includes("T")) return undefined;

  const parsed = parseUtcDateTime(value);
  return parsed === undefined ? undefined : epochSeconds(parsed.getTime());
}

/**
 * rollout-strategies.yaml algorithm.well_known_attributes.fhubWhenActive: compares the clock (`now`, on the
 * left) with the attribute's date-times using its conditional, in whole seconds since the epoch: `now` is
 * already in seconds (ApplyFeature.clock) and each value's fraction of a second is dropped. The type is
 * ignored; INCLUDES, EXCLUDES, STARTS_WITH, ENDS_WITH and REGEX never match, nor do no valid values.
 */
export function fhubWhenActiveMatches(attr: FeatureRolloutStrategyAttribute, now: number): boolean {
  const times = (attr.values ?? [])
    .map((v) => isoEpochSeconds(v))
    .filter((t): t is number => t !== undefined);

  if (times.length === 0) {
    return false;
  }

  switch (attr.conditional) {
    case RolloutStrategyAttributeConditional.Equals:
      return times.some((t) => now === t);
    case RolloutStrategyAttributeConditional.NotEquals:
      return times.every((t) => now !== t);
    case RolloutStrategyAttributeConditional.Greater:
      return times.some((t) => now > t);
    case RolloutStrategyAttributeConditional.GreaterEquals:
      return times.some((t) => now >= t);
    case RolloutStrategyAttributeConditional.Less:
      return times.some((t) => now < t);
    case RolloutStrategyAttributeConditional.LessEquals:
      return times.some((t) => now <= t);
    default:
      // a moment in time cannot be included, excluded, prefixed or pattern-matched
      return false;
  }
}

/** the strategy-only attribute name compared with the clock, never with the context */
export const FHUB_WHEN_ACTIVE = "fhubwhenactive";

export class ApplyFeature {
  /**
   * The clock fhubWhenActive strategies are compared with, in whole seconds since the epoch (FeatureHub
   * compares date-times to the second, never below). Worked out on every evaluation, never cached. Tests
   * may replace it.
   */
  public static clock: () => number = () => epochSeconds(Date.now());

  private readonly _percentageCalculator: PercentageCalculator;
  private readonly _matcherRepository: MatcherRepository;

  constructor(percentageCalculator?: PercentageCalculator, matcherRepository?: MatcherRepository) {
    this._percentageCalculator = percentageCalculator || new Murmur3PercentageCalculator();
    this._matcherRepository = matcherRepository || new MatcherRegistry();
  }

  public apply(
    strategies: Array<FeatureRolloutStrategy> = [],
    _key: string,
    featureValueId: string,
    context?: ClientContext,
  ): Applied {
    if (context !== undefined && strategies.length) {
      let percentage: number | null = null;
      let percentageKey: string | null = null;
      const basePercentage = new Map<string, number>();
      const defaultPercentageKey = context.defaultPercentageKey();

      for (const strategy of strategies) {
        // a null percentage or attributes means the same as an absent one (rollout-strategies.yaml
        // decoding: null, absent and empty all mean none), and an absent percentage counts as 0
        // (algorithm.pseudocode): otherwise a strategy with neither would add NaN to the share, and no
        // later percentage strategy could match (golden_fixture.known_typescript_bugs)
        const rsi = {
          ...strategy,
          percentage: strategy.percentage ?? 0,
          attributes: strategy.attributes ?? undefined,
        };

        if (rsi.percentage !== 0 && (defaultPercentageKey || rsi.percentageAttributes?.length)) {
          const newPercentageKey = ApplyFeature.determinePercentageKey(
            context,
            rsi.percentageAttributes,
          );

          if (!basePercentage.has(newPercentageKey)) {
            basePercentage.set(newPercentageKey, 0);
          }

          const basePercentageVal = basePercentage.get(newPercentageKey)!;

          // if we have changed the key, or we have never calculated it, calculate it and set the
          // base percentage to null
          if (percentage === null || newPercentageKey !== percentageKey) {
            percentageKey = newPercentageKey;
            percentage = this._percentageCalculator.determineClientPercentage(
              percentageKey,
              featureValueId,
            );
          }

          const useBasePercentage =
            rsi.attributes === undefined || rsi.attributes.length === 0 ? basePercentageVal : 0;

          // if the percentage is lower than the user's key +
          // id of feature value then apply it
          if (percentage <= useBasePercentage + rsi.percentage!) {
            if (rsi.attributes != null && rsi.attributes.length) {
              if (this.matchAttribute(context, rsi)) {
                return new Applied(true, rsi.value, rsi.id, true);
              }
            } else {
              return new Applied(true, rsi.value, rsi.id, true);
            }
          }

          // this was only a percentage and had no other attributes
          if ((rsi.attributes?.length || 0) === 0) {
            basePercentage.set(percentageKey, basePercentage.get(percentageKey)! + rsi.percentage!);
          }
        }

        if (
          (rsi.percentage === 0 || rsi.percentage === undefined) &&
          rsi.attributes !== undefined &&
          rsi.attributes.length > 0 &&
          this.matchAttribute(context, rsi)
        ) {
          // nothing to do with a percentage
          return new Applied(true, rsi.value, rsi.id);
        }
      }
    }

    return new Applied(false, undefined, undefined);
  }

  public static determinePercentageKey(
    context: ClientContext,
    percentageAttributes: Array<string> | undefined | null,
  ): string {
    if (!percentageAttributes || percentageAttributes.length === 0) {
      return context.defaultPercentageKey()!;
    }

    return percentageAttributes.map((pa) => caToString(context.getAttr(pa) || "<none>")).join("$");
  }

  private matchAttribute(context: ClientContext, rsi: FeatureRolloutStrategy): boolean {
    for (const attr of rsi.attributes || []) {
      if (attr.fieldName?.toLowerCase() === FHUB_WHEN_ACTIVE) {
        // the time comes from the clock, never the context, and is ANDed with the other attributes
        if (!fhubWhenActiveMatches(attr, ApplyFeature.clock())) {
          return false;
        }

        continue;
      }

      let suppliedValues = context.getAttr(attr.fieldName!);

      if (
        suppliedValues === undefined ||
        (Array.isArray(suppliedValues) &&
          suppliedValues.length == 0 &&
          attr.fieldName!.toLowerCase() === "now")
      ) {
        switch (attr.type) {
          case RolloutStrategyFieldType.Date:
            suppliedValues = [new Date().toISOString().substring(0, 10)];
            break;
          case RolloutStrategyFieldType.Datetime:
            suppliedValues = [isoSeconds(new Date())];
            break;
        }
      }

      if (suppliedValues === undefined) {
        return false;
      }

      // a date-time keeps its Date for DATE and DATETIME attributes; every other matcher compares its UTC
      // ISO-8601 string (Date.toString() would give a local, locale-dependent form)
      const dateMatcher =
        attr.type === RolloutStrategyFieldType.Date ||
        attr.type === RolloutStrategyFieldType.Datetime;
      const comparedValues = (
        (Array.isArray(suppliedValues)
          ? suppliedValues
          : [suppliedValues]) as Array<BaseContextAttribute>
      )
        .map((sv) => (sv instanceof Date && !dateMatcher ? contextValueToString(sv) : sv))
        .filter((sv): sv is BaseContextAttribute => sv !== undefined);

      if (attr.values == null && comparedValues.length == 0) {
        if (attr.conditional !== RolloutStrategyAttributeConditional.Equals) {
          return false;
        }

        continue; // skip
      }

      if (attr.values == null || comparedValues.length == 0) {
        return false;
      }

      const match = comparedValues.find((sv) =>
        this._matcherRepository.findMatcher(attr).match(sv, attr),
      );

      if (!match) {
        return false;
      }
    }

    return true;
  }
}

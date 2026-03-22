import {
  type FeatureHubRepository,
  type FeatureState,
  type FeatureValueInterceptor,
  featureValueFromString,
} from "featurehub-javascript-core-sdk";
import { context, propagation } from "@opentelemetry/api";

/**
 * Reads feature overrides from the OpenTelemetry baggage field `fhub`.
 *
 * The `fhub` baggage value is a comma-separated list of `feature=url-encoded-value` pairs
 * in **alphabetical key order**, e.g.:
 *   `MY_BOOL=true,MY_NUM=42,MY_STR=hello%20world`
 *
 * The alphabetical ordering allows the search to abort early once the current key
 * is lexicographically greater than the key being looked up.
 *
 * Construction options:
 *   - `allowOverrideLocked` (default `false`): when `false`, locked features cannot be
 *     overridden even if they appear in the baggage.
 */
export class OpenTelemetryFeatureInterceptor implements FeatureValueInterceptor {
  private readonly _allowOverrideLocked: boolean;

  constructor(allowOverrideLocked: boolean = false) {
    this._allowOverrideLocked = allowOverrideLocked;
  }

  // overridable in tests
  protected getBaggageEntry(): string | undefined {
    return propagation.getBaggage(context.active())?.getEntry("fhub")?.value;
  }

  matched(
    key: string,
    _repo: FeatureHubRepository,
    featureState?: FeatureState,
  ): [boolean, string | boolean | number | undefined] {
    // locked features cannot be overridden unless explicitly allowed
    if (!this._allowOverrideLocked && featureState?.l === true) {
      return [false, undefined];
    }

    const raw = this.getBaggageEntry();
    if (!raw) {
      return [false, undefined];
    }

    // parse the comma-separated alphabetically ordered list
    const pairs = raw.split(",");

    for (const pair of pairs) {
      const eqIdx = pair.indexOf("=");
      const pairKey = eqIdx === -1 ? pair : pair.substring(0, eqIdx);

      // early exit: list is alphabetically ordered, so if pairKey > key we won't find it
      if (pairKey > key) {
        return [false, undefined];
      }

      if (pairKey === key) {
        if (eqIdx === -1) {
          // key present but no value → feature overridden to undefined/null
          return [true, undefined];
        }

        const encodedValue = pair.substring(eqIdx + 1);
        const decoded = decodeURIComponent(encodedValue);
        const converted = featureValueFromString(featureState?.type, decoded);

        return [true, converted];
      }
    }

    return [false, undefined];
  }
}

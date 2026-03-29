import { AsyncLocalStorage } from "node:async_hooks";

import { context, propagation } from "@opentelemetry/api";
import {
  DefaultUsagePlugin,
  type FeatureHubUsageValue,
  FHLog,
  isUsageEventWithFeature,
  isUsageFeaturesCollection,
  type UsageEvent,
} from "featurehub-javascript-core-sdk";

import {
  buildFhubBaggage,
  encodeRawValue,
  FHUB_BAGGAGE_KEY,
  parseFhubBaggage,
} from "./baggage_utils";


// Per-async-chain accumulator. A single module-level instance is correct: ALS
// automatically segments by async execution context (i.e. per request), so
// values written in one request are invisible to another.
const _featureStore = new AsyncLocalStorage<Map<string, string | undefined>>();

/**
 * Writes evaluated feature values into the OpenTelemetry baggage field `fhub`,
 * doing the reverse of {@link OpenTelemetryFeatureInterceptor}.
 *
 * - {@link UsageEventWithFeature}: updates a single feature in the baggage.
 * - {@link UsageFeaturesCollection}: updates all features in the collection.
 *
 * Keys are always written in alphabetical order. Existing `fhub` entries for
 * other features are preserved. The value stored is the `rawValue` of each
 * feature; `undefined`/`null` is encoded as a key-only entry (no `=`).
 *
 * Must run synchronously (`canSendAsync = false`) so that the baggage is
 * updated before any outgoing propagation occurs.
 *
 * ## How context propagation works
 *
 * The OTel `Context` type is immutable — `propagation.setBaggage()` returns a
 * NEW context rather than mutating the current one, so the result is normally
 * lost. This plugin solves the problem in two complementary ways:
 *
 * 1. **Own `AsyncLocalStorage` accumulator** (`_featureStore`): successive
 *    single-feature `send()` calls within the same request chain accumulate
 *    correctly because each call reads back from the same ALS store rather than
 *    from the (still-unchanged) OTel active context.
 *
 * 2. **`enterWith` on the OTel context manager's ALS**: when
 *    `@opentelemetry/context-async-hooks` is the registered context manager
 *    (the standard Node.js choice), its internal `AsyncLocalStorage` is updated
 *    via `enterWith`, which propagates the new context — including the `fhub`
 *    baggage — to all subsequent async operations in the current chain. This
 *    means OTel-instrumented outgoing HTTP clients automatically carry the
 *    header with no extra wiring. If a different context manager is in use
 *    (e.g. the noop manager or a zone-based browser manager) the `enterWith`
 *    step is silently skipped; accumulation via `_featureStore` still works,
 *    but outgoing propagation would require manual context wrapping.
 */
export class OpenTelemetryBaggagePlugin extends DefaultUsagePlugin {
  public override canSendAsync = false;

  constructor() {
    super();

    _featureStore.enterWith(new Map());
  }

// overridable in tests
  protected getBaggageEntry(): string | undefined {
    // Own store is checked first so that features written earlier in the same
    // async chain are visible — the OTel active context is immutable and would
    // not yet reflect them.
    const store = _featureStore.getStore();
    if (store !== undefined && store.size > 0) {
      return buildFhubBaggage(store);
    }
    // Fall back to the OTel baggage for the incoming fhub on downstream
    // services (set by OTel's HTTP instrumentation from the incoming header).
    return propagation.getBaggage(context.active())?.getEntry(FHUB_BAGGAGE_KEY)?.value;
  }

  // overridable in tests
  protected setBaggageEntry(value: string): void {
    // 1. Update our own accumulator so subsequent getBaggageEntry() calls in
    //    this async chain see the full accumulated state.
    const newEntries = parseFhubBaggage(value);
    let store = _featureStore.getStore();
    if (store === undefined) {
      store = new Map(newEntries);
      _featureStore.enterWith(store);
    } else {
      store.clear();
      newEntries.forEach((v, k) => store!.set(k, v));
    }

    // 2. Also update the OTel active context so that OTel-instrumented
    //    outgoing HTTP calls automatically carry the fhub baggage header.
    this.updateOtelContext(value);
  }

  // Separated from setBaggageEntry so tests can override just this step
  // without losing the ALS accumulation behaviour.
  protected updateOtelContext(value: string): void {
    const current = context.active();
    const existing = propagation.getBaggage(current) ?? propagation.createBaggage();
    const newCtx = propagation.setBaggage(current, existing.setEntry(FHUB_BAGGAGE_KEY, { value }));
    try {
      // @opentelemetry/context-async-hooks exposes _asyncLocalStorage on its
      // context manager. enterWith() makes the new context active for the
      // remainder of the current synchronous execution and all following async
      // operations in this chain, so outgoing instrumented calls see the
      // updated baggage without any extra wiring.
      ((context as any)._getContextManager() as any)._asyncLocalStorage?.enterWith(newCtx);
    } catch {
      // A different context manager is registered (noop, zone-based, etc.).
      // The _featureStore accumulator above still guarantees correct behaviour
      // for getBaggageEntry(); only automatic header injection into OTel
      // instrumented outgoing calls is unavailable in this case.
    }
  }

  public send(event: UsageEvent): void {
    const entries = parseFhubBaggage(this.getBaggageEntry() ?? "");
    let changed = false;

    if (isUsageEventWithFeature(event)) {
      changed = this.applyFeature(entries, event.feature);
    } else if (isUsageFeaturesCollection(event)) {
      for (const fv of event.featureValues) {
        if (this.applyFeature(entries, fv)) {
          changed = true;
        }
      }
    }

    if (changed) {
      this.setBaggageEntry(buildFhubBaggage(entries));
    }
  }

  private applyFeature(
    entries: Map<string, string | undefined>,
    fv: FeatureHubUsageValue,
  ): boolean {
    const encoded = encodeRawValue(fv.rawValue);
    if (entries.has(fv.key) && entries.get(fv.key) !== encoded) {
      FHLog.fhLog.warn(
        `OpenTelemetryBaggagePlugin: attempted to overwrite baggage key "${fv.key}" with a different value — the OpenTelemetryFeatureInterceptor may not be registered correctly.`,
      );
      return false;
    }
    entries.set(fv.key, encoded);
    return true;
  }
}

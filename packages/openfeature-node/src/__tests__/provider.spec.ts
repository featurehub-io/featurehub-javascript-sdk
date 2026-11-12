import { beforeEach, describe, expect, it, vi } from "vitest";

// ---- hoisted shared state for the SDK mock ----
//
// The mock deliberately reproduces the REAL core-SDK semantics that the
// provider depends on:
//   * `attributes = record` MERGES into the existing attribute map
//     (BaseClientContext set attributes never clears), and `clear()` empties
//     the attribute map but does NOT reset the user key.
//   * server-evaluated keys share ONE ServerEvalFeatureContext per config;
//     every `newContext()` (context()/feature()) calls addClient(); only when
//     removeClient() brings the count to 0 does forceClose() actually run.
type Attrs = Record<string, string | undefined>;

const h = vi.hoisted(() => {
  const state = {
    readiness: "Ready" as "NotReady" | "Ready" | "Failed",
    buildSnapshots: [] as Array<Attrs & { userkey?: string }>,
    currentContext: {} as Attrs & { userkey?: string },
    addClientCount: 0,
    removeClientCount: 0,
    forceClosed: false,
  };
  const holders = new Map<
    string,
    {
      exists: boolean;
      getBoolean?: () => boolean | undefined;
      getString?: () => string | undefined;
      getNumber?: () => number | undefined;
      getRawJson?: () => string | undefined;
      getType?: () => string | undefined;
      getVersion?: () => number | undefined;
      getValue?: () => { value?: unknown; strategyId?: string } | undefined;
    }
  >();
  return { state, holders };
});

vi.mock("featurehub-javascript-node-sdk", () => {
  class StubContext {
    _attributes = new Map<string, string>();
    _userKey: string | undefined = undefined;

    // faithful to BaseClientContext: MERGES, never clears
    set attributes(record: Record<string, unknown>) {
      for (const [key, val] of Object.entries(record)) {
        if (val === undefined) continue;
        if (key.toLowerCase() === "userkey") {
          this._userKey = String(val);
        } else {
          this._attributes.set(key, String(val));
        }
      }
    }

    // faithful to BaseClientContext: empties attributes, does NOT reset user key
    clear() {
      this._attributes.clear();
    }

    userKey(value: string | undefined) {
      this._userKey = value;
    }

    close() {
      /* overridden by the config for shared server-eval contexts */
    }

    feature(key: string) {
      const holder = h.holders.get(key);
      return holder ?? { exists: false };
    }

    effectiveContext(): Record<string, string> {
      const eff: Record<string, string> = {};
      for (const [k, v] of this._attributes) eff[k] = v;
      if (this._userKey !== undefined) eff["userkey"] = this._userKey;
      return eff;
    }

    async build() {
      h.state.buildSnapshots.push(this.effectiveContext());
      h.state.currentContext = this.effectiveContext();
    }
  }

  class StubConfig {
    initialized = true;
    isClientEval: boolean;
    private shared: StubContext | undefined;
    readinessListeners: Array<(r: string) => void> = [];

    constructor(apiKey: string) {
      this.isClientEval = apiKey.includes("*");
    }

    addReadinessListener(listener: (r: string) => void) {
      this.readinessListeners.push(listener);
      listener(h.state.readiness);
      return 1;
    }
    removeReadinessListener() {}
    registerRawUpdateFeatureListener() {
      return undefined;
    }
    streaming() {
      return this;
    }
    restActive() {
      return this;
    }
    restPassive() {
      return this;
    }
    init() {}
    async waitForReady() {
      return h.state.readiness;
    }

    context(record?: Record<string, unknown>) {
      if (this.isClientEval) {
        // fresh local context per call — no shared state, no reference counting
        const ctx = new StubContext();
        if (record) ctx.attributes = record;
        return ctx;
      }
      // server-evaluated: ONE shared context, reference-counted via addClient
      if (!this.shared) this.shared = new StubContext();
      h.state.addClientCount += 1;
      if (record) this.shared.attributes = record; // merges — faithful to the SDK
      // faithful to ServerEvalFeatureContext.close(): with a single remaining
      // reference it cascades into config.close() (decrement → forceClose)
      this.shared.close = () => {
        this.close();
      };
      return this.shared;
    }

    feature(key: string) {
      if (this.shared) return this.shared.feature(key);
      const holder = h.holders.get(key);
      return holder ?? { exists: false };
    }

    forceClose() {
      h.state.forceClosed = true;
    }

    close() {
      if (this.shared) {
        h.state.removeClientCount += 1;
        if (h.state.removeClientCount >= h.state.addClientCount) {
          h.state.forceClosed = true; // forceClose only fires at refcount 0
        }
      } else {
        h.state.forceClosed = true;
      }
    }
  }

  return {
    EdgeFeatureHubConfig: class extends StubConfig {
      constructor(_host: string, apiKey: string) {
        super(apiKey);
      }
    },
    // faithful to the core SDK's export
    caToString: (value: unknown, joinSep = ","): string | undefined => {
      if (value === undefined) return undefined;
      return Array.isArray(value) ? value.map((v) => String(v)).join(joinSep) : String(value);
    },
    Readyness: { NotReady: "NotReady", Ready: "Ready", Failed: "Failed" },
  };
});

import { InvalidContextError, mapEvaluationContext, toContextRecord } from "../index";
import { FeatureHubProvider } from "../provider";

const noopLogger = { error: () => {}, warn: () => {}, info: () => {}, debug: () => {} };

function resetFixtures() {
  h.state.readiness = "Ready";
  h.state.buildSnapshots = [];
  h.state.currentContext = {};
  h.state.addClientCount = 0;
  h.state.removeClientCount = 0;
  h.state.forceClosed = false;
  h.holders.clear();
  h.holders.set("bool-flag", {
    exists: true,
    getBoolean: () => true,
    getType: () => "BOOLEAN",
    getVersion: () => 3,
  });
  h.holders.set("str-flag", {
    exists: true,
    getString: () => "blue",
    getType: () => "STRING",
    getVersion: () => 5,
  });
  h.holders.set("num-flag", {
    exists: true,
    getNumber: () => 42,
    getType: () => "NUMBER",
    getVersion: () => 1,
  });
  h.holders.set("json-flag", {
    exists: true,
    getRawJson: () => '{"a":1,"b":[1,2]}',
    getType: () => "JSON",
    getVersion: () => 2,
  });
  h.holders.set("novalue-flag", {
    exists: true,
    getString: () => undefined,
    getType: () => "STRING",
    getVersion: () => 4,
  });
  // every holder defines ALL getters (like the real FeatureStateHolder);
  // getValue() is derived from the typed getter the fixture defines
  const defaults = {
    getBoolean: () => undefined,
    getString: () => undefined,
    getNumber: () => undefined,
    getRawJson: () => undefined,
  };
  for (const [key, holder] of h.holders) {
    const merged = { ...defaults, ...holder };
    h.holders.set(key, {
      ...merged,
      getValue: () => ({
        value:
          merged.getBoolean() ?? merged.getString() ?? merged.getNumber() ?? merged.getRawJson(),
      }),
    });
  }
  h.holders.set("pct-flag", {
    exists: true,
    getBoolean: () => true,
    getType: () => "BOOLEAN",
    getVersion: () => 2,
    // the evaluated feature carries the matched rollout strategy id
    getValue: () => ({ value: true, strategyId: "strategy-42" }),
  });
}

const CLIENT_KEY = "*client-eval-key";
const SERVER_KEY = "default/11111111-2222-3333-4444-555555555556/server-key";

async function readyProvider(apiKey: string) {
  const provider = new FeatureHubProvider({ host: "http://edge.test", apiKey });
  await provider.initialize();
  return provider;
}

describe("context mapping", () => {
  it("maps targetingKey to userkey; session stays session unless server-eval mapping is requested", () => {
    expect(toContextRecord({ targetingKey: "u1", session: "s1", plan: "pro" })).toEqual({
      userkey: "u1",
      session: "s1",
      plan: "pro",
    });
    expect(
      toContextRecord({ targetingKey: "u1", session: "s1" }, { sessionAsSessionKey: true }),
    ).toEqual({ userkey: "u1", sessionkey: "s1" });
  });

  it("rejects nested objects", () => {
    expect(() => mapEvaluationContext({ targetingKey: "u1", x: { a: 1 } })).toThrow(
      InvalidContextError,
    );
  });
});

describe("FeatureHubProvider (client-evaluated key)", () => {
  beforeEach(resetFixtures);

  it("throws without host/apiKey", () => {
    expect(() => new FeatureHubProvider({ host: "", apiKey: "" })).toThrow();
  });

  it("resolves boolean/string/number/object flags from the local repository", async () => {
    const provider = await readyProvider(CLIENT_KEY);
    expect(
      (
        await provider.resolveBooleanEvaluation(
          "bool-flag",
          false,
          { targetingKey: "u1" },
          noopLogger,
        )
      ).value,
    ).toBe(true);
    expect((await provider.resolveStringEvaluation("str-flag", "x", {}, noopLogger)).value).toBe(
      "blue",
    );
    expect((await provider.resolveNumberEvaluation("num-flag", 0, {}, noopLogger)).value).toBe(42);
    const obj = await provider.resolveObjectEvaluation<{ a: number; b?: number[] }>(
      "json-flag",
      { a: 0 },
      {},
      noopLogger,
    );
    expect(obj.value).toEqual({ a: 1, b: [1, 2] });
  });

  it("maps a matched strategy to TARGETING_MATCH with the strategy id as variant", async () => {
    const provider = await readyProvider(CLIENT_KEY);
    const details = await provider.resolveBooleanEvaluation(
      "pct-flag",
      false,
      { targetingKey: "u1" },
      noopLogger,
    );
    expect(details.value).toBe(true);
    expect(details.reason).toBe("TARGETING_MATCH");
    expect(details.variant).toBe("strategy-42");
  });

  it("never performs context rebuilds for client-evaluated keys", async () => {
    const provider = await readyProvider(CLIENT_KEY);
    const ctx = { targetingKey: "u1" };
    await provider.resolveBooleanEvaluation("bool-flag", false, ctx, noopLogger);
    await provider.resolveStringEvaluation("str-flag", "x", ctx, noopLogger);
    expect(h.state.buildSnapshots).toHaveLength(0);
  });

  it("reports FLAG_NOT_FOUND for unknown flags", async () => {
    const provider = await readyProvider(CLIENT_KEY);
    const details = await provider.resolveBooleanEvaluation("nope", true, {}, noopLogger);
    expect(details.value).toBe(true);
    expect(details.errorCode).toBe("FLAG_NOT_FOUND");
  });

  it("uses DEFAULT for value-less features", async () => {
    const provider = await readyProvider(CLIENT_KEY);
    const details = await provider.resolveStringEvaluation(
      "novalue-flag",
      "fallback",
      {},
      noopLogger,
    );
    expect(details.value).toBe("fallback");
    expect(details.reason).toBe("DEFAULT");
  });

  it("reports TYPE_MISMATCH on kind mismatch", async () => {
    const provider = await readyProvider(CLIENT_KEY);
    const details = await provider.resolveNumberEvaluation("str-flag", 0, {}, noopLogger);
    expect(details.errorCode).toBe("TYPE_MISMATCH");
  });

  it("reports INVALID_CONTEXT for unusable contexts", async () => {
    const provider = await readyProvider(CLIENT_KEY);
    const details = await provider.resolveBooleanEvaluation(
      "bool-flag",
      false,
      { targetingKey: "u1", nested: { a: 1 } } as never,
      noopLogger,
    );
    expect(details.errorCode).toBe("INVALID_CONTEXT");
  });

  it("reports PROVIDER_NOT_READY before initialize", async () => {
    const provider = new FeatureHubProvider({ host: "http://edge.test", apiKey: CLIENT_KEY });
    const details = await provider.resolveBooleanEvaluation("bool-flag", false, {}, noopLogger);
    expect(details.errorCode).toBe("PROVIDER_NOT_READY");
  });

  it("force-closes on shutdown (no reference-count leak)", async () => {
    const provider = await readyProvider(CLIENT_KEY);
    await provider.resolveBooleanEvaluation("bool-flag", false, {}, noopLogger);
    await provider.onClose();
    expect(h.state.forceClosed).toBe(true);
  });
});

describe("FeatureHubProvider (server-evaluated key)", () => {
  beforeEach(resetFixtures);

  it("re-fetches the bundle only when the context actually changes", async () => {
    const provider = await readyProvider(SERVER_KEY);
    expect(h.state.buildSnapshots).toHaveLength(1); // initial fetch (empty context)

    await provider.resolveBooleanEvaluation("bool-flag", false, { targetingKey: "u1" }, noopLogger);
    expect(h.state.buildSnapshots).toHaveLength(2);

    await provider.resolveStringEvaluation("str-flag", "x", { targetingKey: "u1" }, noopLogger);
    expect(h.state.buildSnapshots).toHaveLength(2); // same context: served locally

    await provider.resolveBooleanEvaluation("bool-flag", false, { targetingKey: "u2" }, noopLogger);
    expect(h.state.buildSnapshots).toHaveLength(3);
  });

  it("does not leak attributes from one context into the next", async () => {
    const provider = await readyProvider(SERVER_KEY);

    await provider.resolveBooleanEvaluation(
      "bool-flag",
      false,
      { targetingKey: "u1", country: "NZ" },
      noopLogger,
    );
    expect(h.state.buildSnapshots.at(-1)).toEqual({ country: "NZ", userkey: "u1" });

    // user u2 has no attributes — u1's country must not leak into u2's bundle
    await provider.resolveBooleanEvaluation("bool-flag", false, { targetingKey: "u2" }, noopLogger);
    expect(h.state.buildSnapshots.at(-1)).toEqual({ userkey: "u2" });
  });

  it("serialises concurrent resolutions so users never see each other's bundle", async () => {
    const provider = await readyProvider(SERVER_KEY);

    // make evaluation results context-dependent: the flag is true for u1, false for u2
    h.holders.set("ctx-flag", {
      exists: true,
      getType: () => "BOOLEAN",
      getVersion: () => 1,
      getValue: () => ({ value: h.state.currentContext["userkey"] === "u1" }),
    });

    const r1 = provider.resolveBooleanEvaluation(
      "ctx-flag",
      false,
      { targetingKey: "u1" },
      noopLogger,
    );
    const r2 = provider.resolveBooleanEvaluation(
      "ctx-flag",
      false,
      { targetingKey: "u2" },
      noopLogger,
    );
    const [v1, v2] = await Promise.all([r1, r2]);

    expect(v1.value).toBe(true); // u1's evaluation
    expect(v2.value).toBe(false); // u2's evaluation — not u1's leaked bundle
  });

  it("force-closes on shutdown even with a shared server-eval context (no connection leak)", async () => {
    const provider = await readyProvider(SERVER_KEY);
    await provider.resolveBooleanEvaluation("bool-flag", false, { targetingKey: "u1" }, noopLogger);
    await provider.resolveStringEvaluation("str-flag", "x", { targetingKey: "u2" }, noopLogger);

    expect(h.state.addClientCount).toBe(1); // shared context created once in initialize

    // onClose calls config.forceClose() directly, so teardown does not depend
    // on the reference count returning to zero
    await provider.onClose();
    expect(h.state.forceClosed).toBe(true);
  });

  it("resolves flags from the refreshed bundle", async () => {
    const provider = await readyProvider(SERVER_KEY);
    const details = await provider.resolveStringEvaluation(
      "str-flag",
      "x",
      { targetingKey: "u1" },
      noopLogger,
    );
    expect(details.value).toBe("blue");
    expect(details.flagMetadata?.["featureVersion"]).toBe(5);
  });

  it("surfaces the matched strategy id carried on server-evaluated bundles", async () => {
    h.holders.set("sv-flag", {
      exists: true,
      getType: () => "BOOLEAN",
      getVersion: () => 2,
      // the evaluated feature (client and server) carries the matched strategy id
      getValue: () => ({ value: true, strategyId: "strategy-7" }),
    });
    const provider = await readyProvider(SERVER_KEY);
    const details = await provider.resolveBooleanEvaluation("sv-flag", false, {}, noopLogger);
    expect(details.reason).toBe("TARGETING_MATCH");
    expect(details.variant).toBe("strategy-7");
  });
});

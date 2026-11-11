import { beforeEach,describe, expect, it, vi } from "vitest";

// ---- hoisted shared state for the SDK mock ----
const h = vi.hoisted(() => {
  const state = {
    readiness: "Ready" as "NotReady" | "Ready" | "Failed",
    buildCount: 0,
    lastContextRecord: undefined as Record<string, unknown> | undefined,
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
      internalGetValue?: (triggerUsage: boolean) => { strategyId?: string } | undefined;
    }
  >();
  return { state, holders };
});

vi.mock("featurehub-javascript-node-sdk", () => {
  class StubContext {
    attributes: Record<string, unknown> = {};
    feature(key: string) {
      h.state.lastContextRecord = this.attributes;
      const holder = h.holders.get(key);
      return holder ?? { exists: false };
    }
    async build() {
      h.state.buildCount += 1;
    }
  }

  class StubConfig {
    initialized = true;
    readinessListeners: Array<(r: string) => void> = [];

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
    close() {}
    context(record?: Record<string, unknown>) {
      const ctx = new StubContext();
      if (record) {
        ctx.attributes = record;
        h.state.lastContextRecord = record;
      }
      return ctx;
    }
    feature(key: string) {
      const holder = h.holders.get(key);
      return holder ?? { exists: false };
    }
  }

  return {
    EdgeFeatureHubConfig: StubConfig,
    Readyness: { NotReady: "NotReady", Ready: "Ready", Failed: "Failed" },
  };
});

import { InvalidContextError,mapEvaluationContext, toContextRecord } from "../context-mapper";
import { FeatureHubProvider } from "../provider";

const noopLogger = { error: () => {}, warn: () => {}, info: () => {}, debug: () => {} };

function resetFixtures() {
  h.state.readiness = "Ready";
  h.state.buildCount = 0;
  h.state.lastContextRecord = undefined;
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
  h.holders.set("pct-flag", {
    exists: true,
    getBoolean: () => true,
    getType: () => "BOOLEAN",
    getVersion: () => 2,
    // client-evaluated repositories expose the matched strategy like this
    internalGetValue: () => ({ strategyId: "strategy-42" }),
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
  it("maps targetingKey to userkey; session stays session for client-eval", () => {
    expect(toContextRecord({ targetingKey: "u1", session: "s1", plan: "pro" })).toEqual({
      userkey: "u1",
      session: "s1",
      plan: "pro",
    });
    expect(
      toContextRecord({ targetingKey: "u1", session: "s1" }, { sessionAsSessionKey: true }),
    ).toEqual({
      userkey: "u1",
      sessionkey: "s1",
    });
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

  it("never performs per-resolution network calls (no context rebuilds for a stable context)", async () => {
    const provider = await readyProvider(CLIENT_KEY);
    const ctx = { targetingKey: "u1" };
    await provider.resolveBooleanEvaluation("bool-flag", false, ctx, noopLogger);
    await provider.resolveStringEvaluation("str-flag", "x", ctx, noopLogger);
    expect(h.state.buildCount).toBe(0);
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
});

describe("FeatureHubProvider (server-evaluated key)", () => {
  beforeEach(resetFixtures);

  it("re-fetches the bundle only when the context actually changes", async () => {
    const provider = await readyProvider(SERVER_KEY);
    expect(h.state.buildCount).toBe(0); // no initial context supplied

    await provider.resolveBooleanEvaluation("bool-flag", false, { targetingKey: "u1" }, noopLogger);
    expect(h.state.buildCount).toBe(1);

    // same context: served from the local repository
    await provider.resolveStringEvaluation("str-flag", "x", { targetingKey: "u1" }, noopLogger);
    expect(h.state.buildCount).toBe(1);

    // different context: one rebuild
    await provider.resolveBooleanEvaluation("bool-flag", false, { targetingKey: "u2" }, noopLogger);
    expect(h.state.buildCount).toBe(2);
  });

  it("applies the OpenFeature context (session mapped to sessionkey) for server-eval", async () => {
    const provider = await readyProvider(SERVER_KEY);
    await provider.resolveBooleanEvaluation(
      "bool-flag",
      false,
      { targetingKey: "u1", country: "NZ", session: "s1" },
      noopLogger,
    );
    expect(h.state.lastContextRecord).toEqual({ userkey: "u1", country: "NZ", sessionkey: "s1" });
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
});

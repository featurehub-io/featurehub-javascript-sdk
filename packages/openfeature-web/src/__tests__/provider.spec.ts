// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

// ---- hoisted shared state for the SDK mock ----
const h = vi.hoisted(() => {
  const state = {
    readiness: "Ready" as "NotReady" | "Ready" | "Failed",
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
  const appliedContexts: Array<Record<string, unknown>> = [];
  return { state, holders, appliedContexts };
});

vi.mock("featurehub-javascript-client-sdk", () => {
  class StubConfig {
    initialized = true;

    addReadinessListener(listener: (r: string) => void) {
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
    init() {}
    async waitForReady() {
      return h.state.readiness;
    }
    close() {}
    context(record?: Record<string, unknown>) {
      h.appliedContexts.push(record ?? {});
      return {
        feature: (key: string) => {
          const holder = h.holders.get(key);
          return holder ?? { exists: false };
        },
        build: async () => ({}),
      };
    }
  }

  return {
    EdgeFeatureHubConfig: StubConfig,
    Readyness: { NotReady: "NotReady", Ready: "Ready", Failed: "Failed" },
  };
});

import { InvalidContextError, mapEvaluationContext, toContextRecord } from "../context-mapper";
import { FeatureHubWebProvider } from "../provider";

const noopLogger = { error: () => {}, warn: () => {}, info: () => {}, debug: () => {} };

function resetFixtures() {
  h.state.readiness = "Ready";
  h.appliedContexts.length = 0;
  h.holders.clear();
  h.holders.set("bool-flag", {
    exists: true,
    getValue: () => ({ value: true }),
    getType: () => "BOOLEAN",
    getVersion: () => 3,
  });
  h.holders.set("str-flag", {
    exists: true,
    getValue: () => ({ value: "blue" }),
    getType: () => "STRING",
    getVersion: () => 5,
  });
  h.holders.set("pct-flag", {
    exists: true,
    getType: () => "BOOLEAN",
    getVersion: () => 2,
    getValue: () => ({ value: true, strategyId: "strategy-42" }),
  });
  h.holders.set("json-flag", {
    exists: true,
    getValue: () => ({ value: '{"a":1}' }),
    getType: () => "JSON",
    getVersion: () => 1,
  });
}

async function readyProvider(apiKey = "*client-key") {
  const provider = new FeatureHubWebProvider({ host: "http://edge.test", apiKey });
  await provider.initialize();
  return provider;
}

describe("web context mapping", () => {
  it("maps targetingKey to userkey", () => {
    expect(toContextRecord({ targetingKey: "u1", plan: "pro" })).toEqual({
      userkey: "u1",
      plan: "pro",
    });
  });

  it("rejects nested objects", () => {
    expect(() => mapEvaluationContext({ targetingKey: "u1", x: { a: 1 } })).toThrow(
      InvalidContextError,
    );
  });
});

describe("FeatureHubWebProvider", () => {
  beforeEach(resetFixtures);

  it("throws without host/apiKey", () => {
    expect(() => new FeatureHubWebProvider({ host: "", apiKey: "" })).toThrow();
  });
  it("throws on server-evaluated keys (fail fast, no silent mis-resolution)", () => {
    expect(
      () =>
        new FeatureHubWebProvider({ host: "http://edge.test", apiKey: "default/env/server-key" }),
    ).toThrow(/client-evaluated/);
  });

  it("resolves flags synchronously from the local repository", async () => {
    const provider = await readyProvider();
    const b = provider.resolveBooleanEvaluation(
      "bool-flag",
      false,
      { targetingKey: "u1" },
      noopLogger,
    );
    expect(b.value).toBe(true);
    expect(b.flagMetadata?.["featureVersion"]).toBe(3);

    const s = provider.resolveStringEvaluation("str-flag", "x", {}, noopLogger);
    expect(s.value).toBe("blue");
    expect(s.errorCode).toBeUndefined();

    const o = provider.resolveObjectEvaluation<{ a: number; b?: number[] }>(
      "json-flag",
      { a: 0 },
      {},
      noopLogger,
    );
    expect(o.value).toEqual({ a: 1 });
  });

  it("maps a matched strategy to TARGETING_MATCH with a variant", async () => {
    const provider = await readyProvider();
    const details = provider.resolveBooleanEvaluation("pct-flag", false, {}, noopLogger);
    expect(details.reason).toBe("TARGETING_MATCH");
    expect(details.variant).toBe("strategy-42");
  });

  it("applies the OpenFeature context to the SDK context", async () => {
    const provider = await readyProvider();
    provider.resolveBooleanEvaluation("bool-flag", false, { targetingKey: "u1" }, noopLogger);
    expect(h.appliedContexts[h.appliedContexts.length - 1]).toEqual({ userkey: "u1" });
  });

  it("reports FLAG_NOT_FOUND for unknown flags", async () => {
    const provider = await readyProvider();
    const details = provider.resolveBooleanEvaluation("nope", true, {}, noopLogger);
    expect(details.value).toBe(true);
    expect(details.errorCode).toBe("FLAG_NOT_FOUND");
  });

  it("reports PROVIDER_NOT_READY before initialization", () => {
    const provider = new FeatureHubWebProvider({ host: "http://edge.test", apiKey: "*abc" });
    const details = provider.resolveBooleanEvaluation("bool-flag", false, {}, noopLogger);
    expect(details.errorCode).toBe("PROVIDER_NOT_READY");
  });

  it("reports INVALID_CONTEXT for unusable contexts", async () => {
    const provider = await readyProvider();
    const details = provider.resolveBooleanEvaluation(
      "bool-flag",
      false,
      { targetingKey: "u1", nested: { a: 1 } } as never,
      noopLogger,
    );
    expect(details.errorCode).toBe("INVALID_CONTEXT");
  });
});

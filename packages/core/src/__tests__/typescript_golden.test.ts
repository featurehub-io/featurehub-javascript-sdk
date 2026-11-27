import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { ClientContext, ContextAttribute } from "../client_context";
import type { FeatureRolloutStrategy, FeatureRolloutStrategyAttribute } from "../models";
import { ApplyFeature, MatcherRegistry, Murmur3PercentageCalculator } from "../strategy_matcher";

// rollout-strategies.yaml golden_fixture: the conformance suite. This copy MUST stay identical to
// featurehub-sdk-docs specs/fixtures/typescript_golden.json.
interface Golden {
  murmur: Array<{ key: string; hash: number }>;
  percentage: Array<{ key: string; id: string; value: number }>;
  matchers: Array<{
    type: string;
    conditional: string;
    values: Array<unknown>;
    supplied: unknown;
    result: boolean | "throw";
  }>;
  apply: Array<{
    name: string;
    strategies: Array<FeatureRolloutStrategy>;
    featureValueId: string;
    context: Record<string, ContextAttribute>;
    matched: boolean;
    value: unknown;
    strategyId: string | null;
  }>;
}

const golden: Golden = JSON.parse(
  readFileSync(join(__dirname, "fixtures", "typescript_golden.json"), "utf8"),
);

// golden_fixture.known_typescript_bugs: results implementations MUST NOT reproduce
const knownTypeScriptBugs = new Set(["empty strategy first"]);

function context(attrs: Record<string, ContextAttribute>): ClientContext {
  const asKey = (v: ContextAttribute) =>
    v === undefined ? undefined : Array.isArray(v) ? v.map(String).join(",") : String(v);
  return {
    getAttr: (key: string) => attrs[key],
    defaultPercentageKey: () => asKey(attrs["session"]) ?? asKey(attrs["userkey"]),
  } as unknown as ClientContext;
}

describe("the golden fixture (rollout-strategies.yaml golden_fixture)", () => {
  it("murmur3", () => {
    const calculator = new Murmur3PercentageCalculator();
    // percentage_of(key, "") is floor(hash / 2^32 * 1e6), so the hash is checked through it
    for (const { key, hash } of golden.murmur) {
      expect(calculator.determineClientPercentage(key, ""), key).toBe(
        Math.floor((hash / 4294967296) * 1000000),
      );
    }
  });

  it("percentages", () => {
    const calculator = new Murmur3PercentageCalculator();
    for (const { key, id, value } of golden.percentage) {
      expect(calculator.determineClientPercentage(key, id), `${key} ${id}`).toBe(value);
    }
  });

  it("matchers", () => {
    const registry = new MatcherRegistry();
    const failures: string[] = [];

    for (const c of golden.matchers) {
      const attr = {
        conditional: c.conditional,
        type: c.type,
        values: c.values,
        fieldName: "f",
      } as unknown as FeatureRolloutStrategyAttribute;

      let actual: boolean;
      try {
        actual = registry.findMatcher(attr).match(c.supplied as any, attr);
      } catch (_) {
        actual = false;
      }

      // "throw": TypeScript threw; an implementation MUST NOT match
      const expected = c.result === "throw" ? false : c.result;
      if (actual !== expected) {
        failures.push(
          `${c.type} ${c.conditional} ${JSON.stringify(c.values)} ${JSON.stringify(c.supplied)}: expected ${expected}`,
        );
      }
    }

    expect(failures).toEqual([]);
  });

  it("strategies", () => {
    const failures: string[] = [];

    for (const c of golden.apply.filter((a) => !knownTypeScriptBugs.has(a.name))) {
      const applied = new ApplyFeature().apply(
        c.strategies,
        "f",
        c.featureValueId,
        context(c.context),
      );
      const got = {
        matched: applied.matched,
        value: applied.matched ? applied.value : null,
        strategyId: applied.strategyId ?? null,
      };
      const want = { matched: c.matched, value: c.value, strategyId: c.strategyId };
      if (JSON.stringify(got) !== JSON.stringify(want)) {
        failures.push(
          `${c.name}: ${JSON.stringify(c.context)} got ${JSON.stringify(got)} want ${JSON.stringify(want)}`,
        );
      }
    }

    expect(failures).toEqual([]);
  });

  it("skips an empty strategy rather than letting it break later percentages", () => {
    const c = golden.apply.find((a) => a.name === "empty strategy first")!;
    const applied = new ApplyFeature().apply(
      c.strategies,
      "f",
      c.featureValueId,
      context(c.context),
    );

    // golden_fixture.known_typescript_bugs.correct: the 100% strategy matches
    expect(applied.matched).toBe(true);
    expect(applied.strategyId).toBe("all");
  });
});

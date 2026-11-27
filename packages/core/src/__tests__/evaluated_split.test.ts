import { describe, expect, it } from "vitest";

import { ClientEvalFeatureContext } from "../context_impl";
import type { EdgeService } from "../edge_service";
import {
  ClientFeatureRepository,
  type FeatureRolloutStrategy,
  type FeatureState,
  FeatureValueType,
  RolloutStrategyAttributeConditional,
  RolloutStrategyFieldType,
  SSEResultState,
} from "../index";

// openfeature-resolution.yaml evaluation: the strategy id and whether it was a split (a percentage rollout
// matched locally), for SPLIT vs TARGETING_MATCH; a server-applied strategy (`v`) is never a split

const edge = {
  poll: () => Promise.resolve(),
  close: () => {},
  contextChange: () => Promise.resolve(),
  clientEvaluated: () => true,
  requiresReplacementOnHeaderChange: () => false,
} as EdgeService;

const country = (value: string) => ({
  conditional: RolloutStrategyAttributeConditional.Equals,
  fieldName: "country",
  type: RolloutStrategyFieldType.String,
  values: [value],
});

function evaluated(strategies: FeatureRolloutStrategy[] | undefined, v?: string) {
  const repo = new ClientFeatureRepository();
  repo.notify(
    SSEResultState.Features,
    [
      {
        id: "kwong-pastry-id",
        key: "kwong_pastry",
        version: 1,
        type: FeatureValueType.String,
        value: "plain",
        l: false,
        strategies,
        v,
      } as FeatureState,
    ],
    "test",
  );

  const ctx = new ClientEvalFeatureContext(repo, edge)
    .userKey("lingling")
    .country("thailand" as any);
  return ctx.feature("kwong_pastry").getValue(false)!;
}

describe("an evaluated feature's strategy", () => {
  it("is a split for a percentage rollout", () => {
    const e = evaluated([{ id: "omu-co", value: "durian", percentage: 1000000, attributes: [] }]);

    expect(e.value).toBe("durian");
    expect(e.strategyId).toBe("omu-co");
    expect(e.split).toBe(true);
  });

  it("is a split for a percentage rollout with attributes", () => {
    const e = evaluated([
      { id: "omu-co", value: "durian", percentage: 1000000, attributes: [country("thailand")] },
    ] as FeatureRolloutStrategy[]);

    expect(e.strategyId).toBe("omu-co");
    expect(e.split).toBe(true);
  });

  it("is not a split for attributes alone", () => {
    const e = evaluated([
      { id: "chago", value: "mango", attributes: [country("thailand")] },
    ] as FeatureRolloutStrategy[]);

    expect(e.value).toBe("mango");
    expect(e.strategyId).toBe("chago");
    expect(e.split).toBe(false);
  });

  it("is the strategy the server applied (v) when the feature has no strategies, never a split", () => {
    const e = evaluated(undefined, "always-wonder");

    expect(e.value).toBe("plain");
    expect(e.strategyId).toBe("always-wonder");
    expect(e.split).toBe(false);
  });

  it("is none when nothing matched", () => {
    const e = evaluated([
      { id: "chago", value: "mango", attributes: [country("japan")] },
    ] as FeatureRolloutStrategy[]);

    expect(e.value).toBe("plain");
    expect(e.strategyId).toBeUndefined();
    expect(e.split).toBe(false);
  });
});

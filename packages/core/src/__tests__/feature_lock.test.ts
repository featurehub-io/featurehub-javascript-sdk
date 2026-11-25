import { describe, expect, it } from "vitest";

import {
  ClientFeatureRepository,
  type FeatureState,
  FeatureValueType,
  SSEResultState,
} from "../index";

// featurehub-protocol.yaml encoding.feature_state: l is optional, and absent or null means not locked
describe("a feature's lock", () => {
  const feature = (l: boolean | null | undefined, version = 1) =>
    ({
      id: "ling-id",
      key: "keep_silent",
      version,
      type: FeatureValueType.Boolean,
      value: true,
      ...(l === undefined ? {} : { l }),
    }) as unknown as FeatureState;

  it.each([
    [true, true],
    [false, false],
    [null, false],
    [undefined, false],
  ])("with l %o is locked: %s", (l, locked) => {
    const repo = new ClientFeatureRepository();
    repo.notify(SSEResultState.Features, [feature(l)], "test");

    expect(repo.feature("keep_silent").locked).toBe(locked);
    expect(repo.feature("keep_silent").isLocked()).toBe(locked);
  });

  it("does not count null and false as a change", () => {
    const repo = new ClientFeatureRepository();
    repo.notify(SSEResultState.Features, [feature(false)], "test");

    let calls = 0;
    repo.feature("keep_silent").addListener(() => calls++);
    calls = 0;

    repo.notify(SSEResultState.Feature, feature(null, 2), "test");

    expect(calls).toBe(0);
  });
});

describe("a feature appearing or being removed", () => {
  it("calls its listeners, even with no value either side", () => {
    const repo = new ClientFeatureRepository();
    repo.notify(SSEResultState.Features, [], "test");
    let calls = 0;
    repo.feature("chago").addListener(() => calls++);
    calls = 0;

    repo.notify(
      SSEResultState.Feature,
      { id: "orm-id", key: "chago", version: 1, type: FeatureValueType.String } as FeatureState,
      "test",
    );
    expect(calls).toBe(1);

    repo.notify(
      SSEResultState.DeleteFeature,
      { id: "orm-id", key: "chago" } as FeatureState,
      "test",
    );
    expect(calls).toBe(2);
  });
});

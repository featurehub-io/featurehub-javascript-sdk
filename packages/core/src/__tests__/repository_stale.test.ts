import { beforeEach, describe, expect, it } from "vitest";

import {
  ClientFeatureRepository,
  EdgeFeatureHubConfig,
  type FeatureState,
  FeatureValueType,
  Readyness,
  SSEResultState,
} from "../index";

// featurehub-protocol.yaml repository.readiness
describe("readiness follows the FeatureHub protocol", () => {
  let repo: ClientFeatureRepository;
  let seen: Readyness[];

  const orm = (version = 1, value = true): FeatureState => ({
    id: "orm-id",
    key: "orm",
    version,
    type: FeatureValueType.Boolean,
    value,
    l: false,
  });

  beforeEach(() => {
    repo = new ClientFeatureRepository();
    seen = [];
    repo.addReadinessListener((state) => seen.push(state), true);
  });

  it("goes from NotReady to Failed, for good, on a failure before any features", () => {
    repo.notify(SSEResultState.Failure, null, "test");

    expect(repo.readyness).toBe(Readyness.Failed);
    expect(repo.connectionFailed).toBe(true);

    // a later full set (from a store, say) is applied, but Failed is final
    repo.notify(SSEResultState.Features, [orm()], "store");
    expect(repo.readyness).toBe(Readyness.Failed);
    expect(repo.feature("orm").flag).toBe(true);
  });

  it("goes from Ready to Stale on a failure after features, and keeps resolving them", () => {
    repo.notify(SSEResultState.Features, [orm()], "test");
    repo.notify(SSEResultState.Failure, null, "test");

    expect(repo.readyness).toBe(Readyness.Stale);
    expect(repo.connectionFailed).toBe(true);
    expect(repo.feature("orm").flag).toBe(true);
    expect(seen).toEqual([Readyness.Ready, Readyness.Stale]);

    // nothing will bring the features up to date again, so a later full set leaves it Stale
    repo.notify(SSEResultState.Features, [orm(2, false)], "store");
    expect(repo.readyness).toBe(Readyness.Stale);
    expect(repo.feature("orm").flag).toBe(false);
  });

  it("goes from Ready to Stale during a context change, never NotReady, and back to Ready", () => {
    repo.notify(SSEResultState.Features, [orm()], "test");
    repo.notReady();

    expect(repo.readyness).toBe(Readyness.Stale);
    expect(repo.feature("orm").flag).toBe(true);

    repo.notify(SSEResultState.Features, [orm(1, false)], "test");
    expect(repo.readyness).toBe(Readyness.Ready);
    expect(seen).toEqual([Readyness.Ready, Readyness.Stale, Readyness.Ready]);
  });

  it("stays NotReady when the context changes before any features", () => {
    repo.notReady();

    expect(repo.readyness).toBe(Readyness.NotReady);
    expect(seen).toEqual([]);
  });

  it("is a failure during a context change, not Failed, once features have been received", () => {
    repo.notify(SSEResultState.Features, [orm()], "test");
    repo.notReady();
    repo.notify(SSEResultState.Failure, null, "test");

    expect(repo.readyness).toBe(Readyness.Stale);
    expect(repo.connectionFailed).toBe(true);
    expect(repo.feature("orm").flag).toBe(true);
  });

  it("goes from Ready to Stale, for good, when the environment is stale", () => {
    repo.notify(SSEResultState.Features, [orm()], "test");
    repo.markEnvironmentStale();

    expect(repo.readyness).toBe(Readyness.Stale);
    expect(repo.environmentStale).toBe(true);

    repo.notify(SSEResultState.Features, [orm(2)], "test");
    expect(repo.readyness).toBe(Readyness.Stale);
  });

  it("does not change readiness on a stale environment before any features", () => {
    repo.markEnvironmentStale();

    expect(repo.readyness).toBe(Readyness.NotReady);
    expect(repo.environmentStale).toBe(true);
  });

  it("leaves readiness alone on a bye", () => {
    repo.notify(SSEResultState.Features, [orm()], "test");
    repo.notify(SSEResultState.Bye, null, "test");

    expect(repo.readyness).toBe(Readyness.Ready);
    expect(seen).toEqual([Readyness.Ready]);
  });

  it.each([
    ["a string", "keep silent"],
    ["an object", { key: "orm" }],
    ["a number", 7],
  ])("ignores a features notification that is %s", (_name, payload) => {
    repo.notify(SSEResultState.Features, [orm()], "test");
    repo.notify(SSEResultState.Features, payload, "test");

    expect(repo.readyness).toBe(Readyness.Ready);
    expect(repo.feature("orm").exists).toBe(true);
  });

  it("skips features without a version or a type, and their keys count as not in the set", () => {
    repo.notify(SSEResultState.Features, [orm()], "test");
    repo.notify(
      SSEResultState.Features,
      [{ id: "orm-id", key: "orm", value: false } as FeatureState],
      "test",
    );

    expect(repo.feature("orm").exists).toBe(false);

    repo.notify(SSEResultState.Feature, { id: "x", key: "lingling", version: 1 }, "test");
    expect(repo.feature("lingling").exists).toBe(false);
  });

  it("applies a new context's features at once in catch and release mode", () => {
    repo.notify(SSEResultState.Features, [orm()], "test");
    repo.catchAndReleaseMode = true;

    repo.notReady();
    repo.notify(SSEResultState.Features, [orm(1, false)], "test");

    expect(repo.feature("orm").flag).toBe(false);
    expect(repo.readyness).toBe(Readyness.Ready);
  });

  // featurehub-protocol.yaml conformance readiness-broadcast
  it("broadcasts Ready only when it changes, and tells feature listeners of changes separately", () => {
    let changes = 0;
    repo.feature("orm").addListener(() => changes++);

    repo.notify(SSEResultState.Features, [orm(1, true)], "test");
    repo.notify(SSEResultState.Features, [orm(1, true)], "test");
    repo.notify(SSEResultState.Features, [orm(2, false)], "test");

    expect(seen).toEqual([Readyness.Ready]);
    expect(changes).toBe(2); // the first value, then the change to false

    repo.notReady();
    repo.notify(SSEResultState.Features, [orm(2, true)], "test");
    expect(seen).toEqual([Readyness.Ready, Readyness.Stale, Readyness.Ready]);
    expect(changes).toBe(3);
  });

  it("lets waitForReady return as soon as the repository has failed", async () => {
    const config = new EdgeFeatureHubConfig("http://localhost:8080", "123*abc");
    config.repository(repo);
    config.edgeServiceProvider(() => ({
      poll: () => Promise.resolve(),
      contextChange: () => Promise.resolve(),
      clientEvaluated: () => true,
      requiresReplacementOnHeaderChange: () => false,
      close: () => {},
    }));

    repo.notify(SSEResultState.Failure, null, "test");

    const started = Date.now();
    expect(await config.waitForReady(5000)).toBe(Readyness.Failed);
    expect(Date.now() - started).toBeLessThan(1000);
    config.close();
  });
});

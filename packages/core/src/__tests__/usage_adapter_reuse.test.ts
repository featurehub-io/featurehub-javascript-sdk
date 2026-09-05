import { describe, expect, it } from "vitest";

import {
  ClientFeatureRepository,
  EdgeFeatureHubConfig,
  FeatureValueType,
  SSEResultState,
} from "../index";

// `repository()` used to build a new UsageAdapter on every call, and each adapter
// registers a usage stream on the repository that is never removed. Because newContext()
// calls repository(), a service that builds a context per request accumulated one usage
// stream per request, and every feature evaluation then fanned out over all of them --
// so evaluation cost grew with the number of contexts the process had ever created.
//
// The stream map is private, so read it through a narrow cast rather than widening the
// public API just for this assertion.
const usageStreamCount = (repository: ClientFeatureRepository): number =>
  (repository as unknown as { _usageStreams: Map<number, unknown> })._usageStreams.size;

const repositoryWithFeature = () => {
  const repository = new ClientFeatureRepository();
  repository.notify(
    SSEResultState.Features,
    [
      {
        id: "1",
        key: "FEATURE",
        l: false,
        version: 1,
        type: FeatureValueType.Boolean,
        value: true,
      },
    ],
    "test",
  );
  return repository;
};

describe("the usage adapter is created once per repository", () => {
  it("does not register a new usage stream on every repository() call", () => {
    const config = new EdgeFeatureHubConfig();
    const repository = repositoryWithFeature();
    config.repository(repository);

    const initial = usageStreamCount(repository);
    for (let i = 0; i < 100; i++) {
      config.repository();
    }

    expect(usageStreamCount(repository)).toBe(initial);
  });

  it("does not register a new usage stream for every context", () => {
    const config = new EdgeFeatureHubConfig();
    config.isClientEvaluated = true;
    const repository = repositoryWithFeature();
    config.repository(repository);

    const initial = usageStreamCount(repository);
    for (let i = 0; i < 100; i++) {
      config.newContext().feature("FEATURE").value;
    }

    expect(usageStreamCount(repository)).toBe(initial);
  });

  it("rebuilds the adapter when the repository is replaced, releasing the old stream", () => {
    const config = new EdgeFeatureHubConfig();
    const first = repositoryWithFeature();
    const second = repositoryWithFeature();

    config.repository(first);
    const attached = usageStreamCount(first);
    expect(attached).toBeGreaterThan(0);

    config.repository(second);

    expect(usageStreamCount(second)).toBe(attached);
    expect(usageStreamCount(first)).toBe(attached - 1);
  });
});

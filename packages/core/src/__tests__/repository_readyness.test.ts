import { beforeEach, describe, expect, it } from "vitest";

import {
  ClientFeatureRepository,
  EdgeFeatureHubConfig,
  type FeatureState,
  FeatureValueType,
  Readyness,
  SSEResultState,
} from "../index";

describe("Readiness listeners should fire on appropriate events", () => {
  let repo: ClientFeatureRepository;

  beforeEach(() => {
    repo = new ClientFeatureRepository();
  });

  it("should allow us to set readiness on the config", () => {
    const fhConfig = new EdgeFeatureHubConfig("http://localhost:8080", "123*123");
    fhConfig.repository(repo);
    let readinessTrigger = 0;
    let lastReadiness: Readyness | undefined = undefined;
    const triggerHandler = fhConfig.addReadinessListener((state) => {
      lastReadiness = state;
      readinessTrigger++;
    });

    expect(fhConfig.readyness).toBe(Readyness.NotReady);
    expect(readinessTrigger).toBe(1);

    const features = [
      { id: "1", key: "banana", version: 1, type: FeatureValueType.Boolean, value: true },
    ];

    repo.notify(SSEResultState.Features, features, "test");

    expect(fhConfig.readyness).toBe(Readyness.Ready);
    expect(lastReadiness).toBe(Readyness.Ready);
    expect(readinessTrigger).toBe(2);

    fhConfig.removeReadinessListener(triggerHandler);
    repo.notReady();
    // real readiness updates
    expect(fhConfig.readyness).toBe(Readyness.NotReady);
    // but the trigger does not fire
    expect(readinessTrigger).toBe(2);
    expect(lastReadiness).toBe(Readyness.Ready);
  });

  it("should start not ready, receive a list of features and become ready and on failure be failed", () => {
    let readinessTrigger = 0;
    let lastReadiness: Readyness | undefined = undefined;
    repo.addReadinessListener((state) => {
      lastReadiness = state;
      return readinessTrigger++;
    });

    expect(repo.readyness).toBe(Readyness.NotReady);
    expect(readinessTrigger).toBe(1);

    const features = [
      {
        id: "1",
        key: "banana",
        version: 1,
        type: FeatureValueType.Boolean,
        value: true,
      } as FeatureState,
    ];

    repo.notify(SSEResultState.Features, features, "test");

    expect(repo.readyness).toBe(Readyness.Ready);
    expect(lastReadiness).toBe(Readyness.Ready);
    expect(readinessTrigger).toBe(2);

    repo.notify(SSEResultState.Failure, null, "test");
    expect(repo.readyness).toBe(Readyness.Failed);
    expect(lastReadiness).toBe(Readyness.Failed);
    expect(readinessTrigger).toBe(3);
  });

  it("we should be able to be ready and then be still ready on a bye", () => {
    let readinessTrigger = 0;
    let lastReadiness: Readyness | undefined = undefined;
    repo.addReadinessListener((state) => {
      lastReadiness = state;
      return readinessTrigger++;
    });
    const features = [
      {
        id: "1",
        key: "banana",
        version: 1,
        type: FeatureValueType.Boolean,
        value: true,
      } as FeatureState,
    ];

    repo.notify(SSEResultState.Features, features, "test");
    repo.notify(SSEResultState.Bye, undefined, "test");
    expect(repo.readyness).toBe(Readyness.Ready);
    expect(lastReadiness).toBe(Readyness.Ready);
    expect(readinessTrigger).toBe(2);
  });

  it("should re-broadcast ready after notReady is called and features arrive again", () => {
    let readinessTrigger = 0;
    let lastReadiness: Readyness | undefined = undefined;

    repo.addReadinessListener((state) => {
      lastReadiness = state;
      readinessTrigger++;
    });

    const features = [
      {
        id: "1",
        key: "banana",
        version: 1,
        type: FeatureValueType.Boolean,
        value: true,
      } as FeatureState,
    ];

    // First features arrive → Ready
    repo.notify(SSEResultState.Features, features, "test");
    expect(lastReadiness).toBe(Readyness.Ready);
    expect(readinessTrigger).toBe(2); // initial NotReady + Ready

    // Context changes (e.g. userKey), repo goes NotReady
    repo.notReady();
    expect(lastReadiness).toBe(Readyness.NotReady);
    expect(readinessTrigger).toBe(3);

    // Second poll completes with features → must re-broadcast Ready
    repo.notify(SSEResultState.Features, features, "test");
    expect(lastReadiness).toBe(Readyness.Ready);
    expect(readinessTrigger).toBe(4);
    expect(repo.readyness).toBe(Readyness.Ready);
  });

  it("should allow us to register disinterest in the initial notready status", () => {
    let readinessTrigger = 0;
    let lastReadiness: Readyness | undefined = undefined;

    const listener = (state: Readyness) => {
      lastReadiness = state;
      return readinessTrigger++;
    };

    repo.addReadinessListener(listener, true);

    expect(lastReadiness).toBeUndefined();
    expect(readinessTrigger).toBe(0);

    const features = [
      {
        id: "1",
        key: "banana",
        version: 1,
        type: FeatureValueType.Boolean,
        value: true,
      } as FeatureState,
    ];

    repo.notify(SSEResultState.Features, features, "test");

    expect(lastReadiness).toBe(Readyness.Ready);
    expect(readinessTrigger).toBe(1);
    repo.notReady();
    expect(lastReadiness).toBe(Readyness.NotReady);
    repo.removeReadinessListener(listener);
    repo.notify(SSEResultState.Features, features, "test");
    expect(lastReadiness).toBe(Readyness.NotReady);
  });
});

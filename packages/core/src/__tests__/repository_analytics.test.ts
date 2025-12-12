import { beforeEach, describe, expect, it } from "vitest";

import {
  ClientFeatureRepository,
  EdgeFeatureHubConfig,
  type FeatureState,
  type FeatureStateHolder,
  FeatureValueType,
  SSEResultState,
} from "../index";

describe("We should be able to log an analytics event", () => {
  let repo: ClientFeatureRepository;
  let firedAction: string | undefined;
  let firedOther: Map<string, string> | undefined;
  let firedFeatures: Array<FeatureStateHolder> | undefined;

  beforeEach(() => {
    repo = new ClientFeatureRepository();
    firedAction = undefined;
    firedOther = undefined;
    firedFeatures = undefined;

    repo.addAnalyticCollector({
      logEvent: function (
        action: string,
        other: Map<string, string>,
        featureStateAtCurrentTime: Array<FeatureStateHolder>,
      ) {
        firedAction = action;
        firedOther = other;
        firedFeatures = featureStateAtCurrentTime;
      },
    });
  });

  it("should allow us to fire analytics events via the config into the repo", () => {
    repo = new ClientFeatureRepository();
    const fhConfig = new EdgeFeatureHubConfig("http://localhost:8080", "123*123");
    fhConfig.repository(repo);
    fhConfig.addAnalyticCollector({
      logEvent: function (
        action: string,
        other: Map<string, string>,
        featureStateAtCurrentTime: Array<FeatureStateHolder>,
      ) {
        firedAction = action;
        firedOther = other;
        firedFeatures = featureStateAtCurrentTime;
      },
    });
    repo.logAnalyticsEvent("name");
    expect(firedFeatures?.length).toBe(0);
    expect(firedAction).toBe("name");
    expect(firedOther?.size).toBe(0);
  });

  it("Should enable us to log an event with no other and no features", () => {
    repo.logAnalyticsEvent("name");
    expect(firedFeatures?.length).toBe(0);
    expect(firedAction).toBe("name");
    expect(firedOther?.size).toBe(0);
  });

  it("should carry through the other field", () => {
    const other = new Map();
    other.set("ga", "value");
    repo.logAnalyticsEvent("name", other);
    expect(firedFeatures?.length).toBe(0);
    expect(firedAction).toBe("name");
    expect(firedOther).toBe(other);
  });

  it("should snapshot the features", () => {
    const features: Array<FeatureState> = [
      { id: "1", key: "banana", version: 1, type: FeatureValueType.Boolean, value: true },
    ];

    repo.notify(SSEResultState.Features, features);

    repo.logAnalyticsEvent("name");

    expect(firedFeatures?.length).toBe(1);
    const fs = firedFeatures![0];
    expect(fs?.isSet()).toBe(true);
    expect(fs?.getBoolean()).toBe(true);
    expect(fs?.getKey()).toBe("banana");
  });
});

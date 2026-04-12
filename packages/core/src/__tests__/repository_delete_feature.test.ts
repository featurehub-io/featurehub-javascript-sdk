import { beforeEach, describe, expect, it } from "vitest";

import {
  ClientFeatureRepository,
  type FeatureState,
  FeatureValueType,
  SSEResultState,
} from "../index";

describe("if a feature is deleted it becomes undefined", () => {
  let repo: ClientFeatureRepository;
  let features: Array<FeatureState>;

  beforeEach(() => {
    repo = new ClientFeatureRepository();
    features = [
      {
        id: "1",
        key: "banana",
        version: 2,
        type: FeatureValueType.Boolean,
        value: true,
        environmentId: "1",
      } as FeatureState,
      {
        id: "2",
        key: "orm",
        version: 2,
        type: FeatureValueType.String,
        environmentId: "1",
      },
      {
        id: "3",
        key: "lingling",
        version: 2,
        type: FeatureValueType.Number,
        environmentId: "1",
      },
      {
        id: "4",
        key: "uni",
        version: 2,
        type: FeatureValueType.Json,
        environmentId: "1",
      },
    ];

    repo.notify(SSEResultState.Features, features, "test");
  });

  it("should allow us to delete a feature", () => {
    expect(repo.feature("banana").flag).toBe(true);
    expect(repo.getFlag("banana")).toBe(true);
    expect(repo.feature("banana").exists).toBe(true);
    repo.notify(SSEResultState.DeleteFeature, features[0], "test");
    expect(repo.feature("banana").exists).toBe(false);
    expect(repo.feature("banana").flag).toBeUndefined();
    expect(repo.getFlag("banana")).toBeUndefined();
    expect(repo.isSet("banana")).toBe(false);
    expect(repo.feature("banana").isSet()).toBe(false);
    expect(repo.feature("lingling").isSet()).toBe(false);
    expect(repo.feature("orm").isSet()).toBe(false);
    expect(repo.feature("uni").isSet()).toBe(false);
  });

  it("should ignore a delete if the version is lower than the existing version", () => {
    repo.notify(
      SSEResultState.DeleteFeature,
      {
        id: "1",
        key: "banana",
        version: 1,
        type: FeatureValueType.Boolean,
        value: true,
      } as FeatureState,
      "test",
    );
    expect(repo.feature("banana").value).toBe(true);
  });

  it("should delete if the feature version is 0", () => {
    repo.notify(
      SSEResultState.DeleteFeature,
      {
        id: "1",
        key: "banana",
        version: 0,
        type: FeatureValueType.Boolean,
        value: true,
      } as FeatureState,
      "test",
    );
    expect(repo.feature("banana").isSet()).toBe(false);
  });

  it("should delete if the feature version is undefined", () => {
    repo.notify(
      SSEResultState.DeleteFeature,
      {
        id: "1",
        key: "banana",
        version: undefined,
        type: FeatureValueType.Boolean,
        value: true,
      } as FeatureState,
      "test",
    );
    expect(repo.feature("banana").isSet()).toBe(false);
  });

  it("if features are deleted from FH, on the next poll they won't turn up, so we should indicate they don't exist", () => {
    repo.notify(SSEResultState.Features, features, "test");
    expect(repo.feature("banana").exists).toBe(true);
    repo.notify(SSEResultState.Features, [], "test");
    expect(repo.feature("banana").exists).toBe(false);
  });

  it("if a single feature is removed it is properly removed from feature keys", () => {
    repo.notify(SSEResultState.Features, features, "test");
    expect(repo.featureKeys).to.include("banana");
    const newFeatures = [features[1], features[2]];
    repo.notify(SSEResultState.Features, newFeatures, "test");
    expect(repo.featureKeys).to.not.include("banana");
  });

  it("should ignore deleting a feature that doesnt exist", () => {
    repo.notify(
      SSEResultState.DeleteFeature,
      {
        id: "1",
        key: "apple",
        version: 1,
        type: FeatureValueType.Boolean,
        value: true,
      } as FeatureState,
      "test",
    );

    expect(repo.getFeatureState("apple").isSet()).toBe(false);
    expect(repo.getFeatureState("banana").isSet()).toBe(true);
  });
});

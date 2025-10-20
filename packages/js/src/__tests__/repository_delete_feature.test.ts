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
      } as FeatureState,
    ];

    repo.notify(SSEResultState.Features, features);
  });

  it("should allow us to delete a feature", () => {
    expect(repo.feature("banana").flag).toBe(true);
    expect(repo.getFlag("banana")).toBe(true);
    expect(repo.feature("banana").exists).toBe(true);
    repo.notify(SSEResultState.DeleteFeature, features[0]);
    expect(repo.feature("banana").exists).toBe(false);
    expect(repo.feature("banana").flag).toBeUndefined();
    expect(repo.getFlag("banana")).toBeUndefined();
    expect(repo.isSet("banana")).toBe(false);
    expect(repo.feature("banana").isSet()).toBe(false);
  });

  it("should ignore a delete if the version is lower than the existing version", () => {
    repo.notify(SSEResultState.DeleteFeature, {
      id: "1",
      key: "banana",
      version: 1,
      type: FeatureValueType.Boolean,
      value: true,
    } as FeatureState);
    expect(repo.feature("banana").value).toBe(true);
  });

  it("should delete if the feature version is 0", () => {
    repo.notify(SSEResultState.DeleteFeature, {
      id: "1",
      key: "banana",
      version: 0,
      type: FeatureValueType.Boolean,
      value: true,
    } as FeatureState);
    expect(repo.feature("banana").isSet()).toBe(false);
  });

  it("should delete if the feature version is undefined", () => {
    repo.notify(SSEResultState.DeleteFeature, {
      id: "1",
      key: "banana",
      version: undefined,
      type: FeatureValueType.Boolean,
      value: true,
    } as FeatureState);
    expect(repo.feature("banana").isSet()).toBe(false);
  });

  it("if features are deleted from FH, on the next poll they won't turn up, so we should indicate they don't exist", () => {
    repo.notify(SSEResultState.Features, features);
    expect(repo.feature("banana").exists).toBe(true);
    repo.notify(SSEResultState.Features, []);
    expect(repo.feature("banana").exists).toBe(false);
  });

  it("should ignore deleting a feature that doesnt exist", () => {
    repo.notify(SSEResultState.DeleteFeature, {
      id: "1",
      key: "apple",
      version: 1,
      type: FeatureValueType.Boolean,
      value: true,
    } as FeatureState);

    expect(repo.getFeatureState("apple").isSet()).toBe(false);
    expect(repo.getFeatureState("banana").isSet()).toBe(true);
  });
});

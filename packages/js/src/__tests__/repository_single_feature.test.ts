/* tslint:disable */
/* eslint-disable */
import {
  type ClientContext,
  ClientFeatureRepository,
  FeatureValueType,
  SSEResultState,
} from "../index";
import { describe, it, expect, beforeEach } from "vitest";
import { Substitute } from "@fluffy-spoon/substitute";

describe("repository reacts to single feature changes as expected", () => {
  let repo: ClientFeatureRepository;

  beforeEach(() => {
    repo = new ClientFeatureRepository();
  });

  it("should be able to recognize newly created values that are not set", () => {
    const features = [{ id: "1", key: "pear", version: 0, type: FeatureValueType.String }];

    repo.notify(SSEResultState.Features, features);

    expect(repo.feature("pear").getVersion()).toBe(0);

    repo.notify(SSEResultState.Feature, {
      id: "1",
      key: "pear",
      version: 1,
      type: FeatureValueType.String,
      value: "now-set",
      fp: { category: "shoes", appName: "cajon" },
    });

    const str = repo.feature<string>("pear").value;
    expect(str).toBe("now-set");
    expect(repo.feature("pear").getVersion()).toBe(1);
    expect(repo.feature("pear").version).toBe(1);
    expect(repo.feature("pear").getString()).toBe("now-set");
    expect(repo.feature("pear").str).toBe("now-set");
    expect(repo.feature("pear").featureProperties).toEqual({
      category: "shoes",
      appName: "cajon",
    });
  });

  it("should specify undefined for unknown feature values", () => {
    // tslint:disable-next-line:no-unused-expression
    expect(repo.getFeatureState("bool").getBoolean()).toBeUndefined();
    expect(repo.getFeatureState("bool").flag).toBeUndefined();
    // tslint:disable-next-line:no-unused-expression
    expect(repo.getFeatureState("num").getNumber()).toBeUndefined();
    expect(repo.getFeatureState("num").num).toBeUndefined();
    // tslint:disable-next-line:no-unused-expression
    expect(repo.getFeatureState("str").getString()).toBeUndefined();
    expect(repo.getFeatureState("str").str).toBeUndefined();
    // tslint:disable-next-line:no-unused-expression
    expect(repo.getFeatureState("str").getRawJson()).toBeUndefined();
    expect(repo.getFeatureState("str").rawJson).toBeUndefined();

    const ctx = Substitute.for<ClientContext>();
    const feat = repo.getFeatureState("bool").withContext(ctx);
    // tslint:disable-next-line:no-unused-expression
    expect(feat.flag).toBeUndefined();
  });

  it("should be able to deal with pure json data", () => {
    let triggerBanana = 0;
    let triggerPear = 0;
    let triggerPeach = 0;

    repo.getFeatureState("banana").addListener(() => triggerBanana++);
    repo.getFeatureState("pear").addListener(() => triggerPear++);
    repo.getFeatureState("peach").addListener(() => triggerPeach++);

    const features = [
      { id: "1", key: "banana", version: 1, type: FeatureValueType.Json, value: "{}" },
      { id: "2", key: "pear", version: 1, type: FeatureValueType.Json, value: '"nashi"' },
      {
        id: "3",
        key: "peach",
        version: 1,
        type: FeatureValueType.Json,
        value: '{"variety": "golden queen"}',
      },
    ];

    repo.notify(SSEResultState.Features, features);

    repo.notify(SSEResultState.Feature, {
      id: "1",
      key: "banana",
      version: 2,
      type: FeatureValueType.Json,
      value: "{}",
    });

    // banana doesn't change because version diff + value same
    expect(triggerBanana).toBe(1);

    repo.notify(SSEResultState.Feature, {
      id: "1",
      key: "banana",
      version: 3,
      type: FeatureValueType.Json,
      value: '"yellow"',
    });

    expect(triggerBanana).toBe(2);
    expect(triggerPear).toBe(1);
    expect(triggerPeach).toBe(1);

    repo.notify(SSEResultState.DeleteFeature, { id: "1", key: "banana" });

    expect(repo.hasFeature("banana")).toBeDefined();
    expect(repo.hasFeature("banana")?.getRawJson()).toBeUndefined();
  });

  it("should react to a single feature changing", () => {
    let triggerBanana = 0;
    let triggerPear = 0;
    let triggerPeach = 0;

    repo.getFeatureState("banana").addListener(() => triggerBanana++);
    repo.getFeatureState("pear").addListener(() => triggerPear++);
    repo.getFeatureState("peach").addListener(() => triggerPeach++);

    const features = [
      { id: "1", key: "banana", version: 1, type: FeatureValueType.Json, value: "{}", l: false },
      { id: "2", key: "pear", version: 1, type: FeatureValueType.Json, value: '"nashi"' },
      {
        id: "3",
        key: "peach",
        version: 1,
        type: FeatureValueType.Json,
        value: '{"variety": "golden queen"}',
      },
    ];

    repo.notify(SSEResultState.Features, features);

    repo.notify(SSEResultState.Feature, {
      id: "1",
      key: "banana",
      l: false,
      version: 2,
      type: FeatureValueType.Json,
      value: "{}",
    });

    // banana doesn't change because version diff + value same
    expect(triggerBanana).toBe(1);

    repo.notify(SSEResultState.Feature, {
      id: "1",
      key: "banana",
      l: true,
      version: 3,
      type: FeatureValueType.Json,
      value: '"yellow"',
    });

    expect(triggerBanana).toBe(2);
    expect(triggerPear).toBe(1);
    expect(triggerPeach).toBe(1);
  });

  it("should react when the version stays the same but the value changes", () => {
    const features = [
      { id: "1", key: "apricot", version: 1, type: FeatureValueType.Number, value: 12.8 },
    ];
    repo.notify(SSEResultState.Features, features);
    repo.notify(SSEResultState.Feature, {
      id: "1",
      key: "apricot",
      version: 1,
      type: FeatureValueType.Number,
      value: 12.9,
    });
    expect(repo.feature("apricot").getNumber()).toBe(12.9);
    expect(repo.feature("apricot").num).toBe(12.9);
  });

  it("should allow me to add and remove listeners", () => {
    let triggerRhubarb = 0;
    const handle = repo.feature("rhubarb").addListener(() => triggerRhubarb++);
    const features = [
      { id: "1", key: "rhubarb", version: 1, type: FeatureValueType.Number, value: 12.8 },
    ];
    repo.notify(SSEResultState.Features, features);
    expect(triggerRhubarb).toBe(1);
    repo.feature("rhubarb").removeListener(handle);
    const features1 = [
      { id: "1", key: "rhubarb", version: 2, type: FeatureValueType.Number, value: 17.8 },
    ];
    repo.notify(SSEResultState.Features, features1);
    expect(triggerRhubarb).toBe(1);
    expect(repo.feature("rhubarb").num).toBe(17.8);
  });
});

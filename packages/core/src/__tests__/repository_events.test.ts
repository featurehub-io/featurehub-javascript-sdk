import { Substitute } from "@fluffy-spoon/substitute";
import { beforeEach, describe, expect, it } from "vitest";

import {
  ClientFeatureRepository,
  EdgeFeatureHubConfig,
  type EdgeService,
  type FeatureRolloutStrategy,
  type FeatureRolloutStrategyAttribute,
  type FeatureState,
  FeatureValueType,
  RolloutStrategyAttributeConditional,
  RolloutStrategyFieldType,
  SSEResultState,
} from "../index";

describe("Feature repository reacts to incoming event lists as expected", () => {
  let repo: ClientFeatureRepository;

  beforeEach(() => {
    repo = new ClientFeatureRepository();
  });

  it("Can handle null or undefined feature states", () => {
    repo.notify(SSEResultState.Features, [undefined]);
  });

  it("Can handle post new state available handlers failing and letting subsequent ones continue", () => {
    let postTrigger = 0;
    let failTrigger = 0;
    repo.addPostLoadNewFeatureStateAvailableListener(() => {
      failTrigger++;
      throw new Error("blah");
    });
    repo.addPostLoadNewFeatureStateAvailableListener(() => postTrigger++);
    const features = [
      { id: "1", key: "banana", version: 1, type: FeatureValueType.Boolean, value: true },
    ];

    repo.notify(SSEResultState.Features, features);
    repo.notify(SSEResultState.Feature, {
      id: "1",
      key: "banana",
      version: 2,
      type: FeatureValueType.Boolean,
      value: false,
    } as FeatureState);

    expect(postTrigger).toBe(1);
    expect(failTrigger).toBe(1);
  });

  it("should accept a list of boolean features sets and triggers updates and stores values as expect", () => {
    let triggerBanana = 0;
    let triggerPear = 0;
    let triggerPeach = 0;

    repo.getFeatureState("banana").addListener(() => triggerBanana++);
    repo.getFeatureState("pear").addListener(() => triggerPear++);
    repo.getFeatureState("peach").addListener(() => triggerPeach++);

    expect(triggerBanana).toBe(0);
    expect(triggerPear).toBe(0);
    expect(triggerPeach).toBe(0);

    expect(repo.getFeatureState("banana").getBoolean()).toBeUndefined();
    expect(repo.getFeatureState("banana").isSet()).toBe(false);
    expect(repo.getFeatureState("pear").getBoolean()).toBeUndefined();
    expect(repo.getFeatureState("peach").getBoolean()).toBeUndefined();

    const features = [
      { id: "1", key: "banana", version: 1, type: FeatureValueType.Boolean, value: true },
      { id: "2", key: "pear", version: 1, type: FeatureValueType.Boolean, value: false },
      { id: "3", key: "peach", version: 1, type: FeatureValueType.Boolean, value: true },
    ];

    repo.notify(SSEResultState.Features, features);

    expect(triggerBanana).toBe(1);
    expect(triggerPear).toBe(1);
    expect(triggerPeach).toBe(1);
    expect(repo.getFeatureState("banana").getBoolean()).toBe(true);
    expect(repo.getFeatureState("pear").getBoolean()).toBe(false);
    expect(repo.getFeatureState("peach").getBoolean()).toBe(true);

    const features2 = [
      { id: "1", key: "banana", version: 2, type: FeatureValueType.Boolean, value: false },
      { id: "2", key: "pear", version: 1, type: FeatureValueType.Boolean, value: false },
      { id: "3", key: "peach", version: 2, type: FeatureValueType.Boolean, value: true },
    ];

    // only banana should trigger as it has changed its value and its version
    repo.notify(SSEResultState.Features, features2);

    expect(triggerBanana).toBe(2);
    expect(triggerPear).toBe(1);
    expect(triggerPeach).toBe(1);
    expect(repo.getFeatureState("banana").getBoolean()).toBe(false);
    expect(repo.getFeatureState("pear").getBoolean()).toBe(false);
    expect(repo.getFeatureState("peach").getBoolean()).toBe(true);
  });

  it("should accept a list of number features sets and triggers updates and stores values as expect", () => {
    let triggerBanana = 0;
    let triggerPear = 0;
    let triggerPeach = 0;

    repo.getFeatureState("banana").addListener(() => triggerBanana++);
    repo.getFeatureState("pear").addListener(() => triggerPear++);
    repo.getFeatureState("peach").addListener(() => triggerPeach++);

    const features = [
      { id: "1", key: "banana", version: 1, type: FeatureValueType.Number, value: 7.2 },
      { id: "2", key: "pear", version: 1, type: FeatureValueType.Number, value: 15 },
      { id: "3", key: "peach", version: 1, type: FeatureValueType.Number, value: 56534.23 },
    ];

    repo.notify(SSEResultState.Features, features);

    expect(triggerBanana).toBe(1);
    expect(triggerPear).toBe(1);
    expect(triggerPeach).toBe(1);
    expect(repo.getFeatureState("banana").getNumber()).toBe(7.2);
    expect(repo.getFeatureState("pear").getNumber()).toBe(15);
    expect(repo.getFeatureState("peach").getNumber()).toBe(56534.23);

    const features2 = [
      { id: "1", key: "banana", version: 2, type: FeatureValueType.Number, value: 16 },
      { id: "2", key: "pear", version: 1, type: FeatureValueType.Number, value: 15 },
      { id: "3", key: "peach", version: 2, type: FeatureValueType.Number, value: 56534.23 },
    ];

    // only banana should trigger as it has changed its value and its version
    repo.notify(SSEResultState.Features, features2);

    expect(triggerBanana).toBe(2);
    expect(triggerPear).toBe(1);
    expect(triggerPeach).toBe(1);
    expect(repo.getFeatureState("banana").getNumber()).toBe(16);
    expect(repo.getFeatureState("pear").getNumber()).toBe(15);
    expect(repo.getFeatureState("peach").getNumber()).toBe(56534.23);
    expect(repo.getNumber("pear")).toBe(15);
    expect(repo.isSet("pear")).toBe(true);
  });

  it("should accept and trigger events via a context and the repo in the same fashion for the same feature", async () => {
    const fhConfig = new EdgeFeatureHubConfig("http://localhost:8080", "123*123");
    fhConfig.repository(repo);
    const edgeService = Substitute.for<EdgeService>();
    edgeService.poll().returns(new Promise<void>(() => {}));
    fhConfig.edgeServiceProvider(() => edgeService);

    let triggerContext = 0;
    let triggerRepo = 0;
    let contextNumber = 0;
    let repoNumber = 0;

    repo.getFeatureState("fruit").addListener((fs) => {
      repoNumber = fs.getNumber()!;
      triggerRepo++;
    });
    const fhContext = await fhConfig.newContext().userKey("fred").build();
    const feat = fhContext.feature("fruit");
    feat.addListener((fs) => {
      contextNumber = fs.getNumber()!;
      triggerContext++;
    });

    const features = [
      {
        id: "1",
        key: "fruit",
        version: 2,
        type: FeatureValueType.Number,
        value: 16,
        strategies: [
          {
            id: "1",
            value: 12,
            attributes: [
              {
                type: RolloutStrategyFieldType.String,
                fieldName: "userkey",
                values: ["fred"],
                conditional: RolloutStrategyAttributeConditional.Equals,
              } as FeatureRolloutStrategyAttribute,
            ],
          } as FeatureRolloutStrategy,
        ],
      } as FeatureState,
    ];

    // only banana should trigger as it has changed its value and its version
    repo.notify(SSEResultState.Features, features);

    expect(triggerContext).toBe(1);
    expect(triggerRepo).toBe(1);
    expect(repoNumber).toBe(16);
    expect(contextNumber).toBe(12);

    // mimic the same revision coming through, but a different main value, which is what would happen for a server
    // eval change
    const features2 = [
      {
        id: "1",
        key: "fruit",
        version: 2,
        type: FeatureValueType.Number,
        value: 17,
        strategies: [
          {
            id: "1",
            value: 13,
            attributes: [
              {
                type: RolloutStrategyFieldType.String,
                fieldName: "userkey",
                values: ["fred"],
                conditional: RolloutStrategyAttributeConditional.Equals,
              } as FeatureRolloutStrategyAttribute,
            ],
          } as FeatureRolloutStrategy,
        ],
      } as FeatureState,
    ];

    repo.notify(SSEResultState.Features, features2);

    expect(triggerContext).toBe(2);
    expect(triggerRepo).toBe(2);
    expect(repoNumber).toBe(17);
    expect(contextNumber).toBe(13);
  });

  it("should accept a list of string features sets and triggers updates and stores values as expect", () => {
    let triggerBanana = 0;
    let triggerPear = 0;
    let triggerPeach = 0;

    repo.getFeatureState("banana").addListener(() => triggerBanana++);
    repo.getFeatureState("pear").addListener(() => triggerPear++);
    repo.getFeatureState("peach").addListener(() => triggerPeach++);

    const features = [
      { id: "1", key: "banana", version: 1, type: FeatureValueType.String, value: "7.2" },
      { id: "2", key: "pear", version: 1, type: FeatureValueType.String, value: "15" },
      { id: "3", key: "peach", version: 1, type: FeatureValueType.String, value: "56534.23" },
    ];

    repo.notify(SSEResultState.Features, features);

    expect(triggerBanana).toBe(1);
    expect(triggerPear).toBe(1);
    expect(triggerPeach).toBe(1);
    expect(repo.getFeatureState("banana").getString()).toBe("7.2");
    expect(repo.feature("banana").str).toBe("7.2");
    expect(repo.getFeatureState("pear").getString()).toBe("15");
    expect(repo.feature("pear").str).toBe("15");
    expect(repo.getFeatureState("peach").getString()).toBe("56534.23");

    const features2 = [
      { id: "1", key: "banana", version: 2, type: FeatureValueType.String, value: "16" },
      { id: "2", key: "pear", version: 1, type: FeatureValueType.String, value: "15" },
      { id: "3", key: "peach", version: 2, type: FeatureValueType.String, value: "56534.23" },
    ];

    // only banana should trigger as it has changed its value and its version
    repo.notify(SSEResultState.Features, features2);

    expect(triggerBanana).toBe(2);
    expect(triggerPear).toBe(1);
    expect(triggerPeach).toBe(1);
    expect(repo.getFeatureState("banana").getString()).toBe("16");
    expect(repo.getFeatureState("pear").getString()).toBe("15");
    expect(repo.getFeatureState("peach").getString()).toBe("56534.23");
    expect(repo.getString("peach")).toBe("56534.23");
  });

  it("should accept a list of json features sets and triggers updates and stores values as expect", () => {
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

    expect(triggerBanana).toBe(1);
    expect(triggerPear).toBe(1);
    expect(triggerPeach).toBe(1);
    expect(repo.getFeatureState("banana").getRawJson()).toBe("{}");
    expect(repo.getFeatureState("pear").getRawJson()).toBe('"nashi"');
    expect(repo.getFeatureState("peach").getRawJson()).toBe('{"variety": "golden queen"}');

    const features2 = [
      { id: "1", key: "banana", version: 2, type: FeatureValueType.Json, value: '"yellow"' },
      { id: "2", key: "pear", version: 1, type: FeatureValueType.Json, value: '"nashi"' },
      {
        id: "3",
        key: "peach",
        version: 2,
        type: FeatureValueType.Json,
        value: '{"variety": "golden queen"}',
      },
    ];

    // only banana should trigger as it has changed its value and its version
    repo.notify(SSEResultState.Features, features2);

    expect(triggerBanana).toBe(2);
    expect(triggerPear).toBe(1);
    expect(triggerPeach).toBe(1);
    expect(repo.getFeatureState("banana").getRawJson()).toBe('"yellow"');
    expect(repo.getFeatureState("pear").getRawJson()).toBe('"nashi"');
    expect(repo.getFeatureState("peach").getRawJson()).toBe('{"variety": "golden queen"}');
    expect(repo.getJson("pear")).toBe('"nashi"');
    expect(repo.isSet("pear")).toBe(true);
  });
});

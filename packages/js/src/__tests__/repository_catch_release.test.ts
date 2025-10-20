/* tslint:disable */
/* eslint-disable */
import {
  ClientFeatureRepository,
  type FeatureHubRepository,
  type FeatureState,
  FeatureValueType,
  SSEResultState,
} from "../index";
import { describe, it, expect } from "vitest";
import type { InternalFeatureRepository } from "../internal_feature_repository";

describe("Catch and release should hold and then release feature changes", () => {
  it("should not get confused when a feature update has arrived alone", async () => {
    const repo: FeatureHubRepository = new ClientFeatureRepository();
    const internalRepo: InternalFeatureRepository = repo as InternalFeatureRepository;
    repo.catchAndReleaseMode = true;
    const features: Array<FeatureState> = [
      { id: "1", key: "banana", version: 1, type: FeatureValueType.String, value: "yellow" },
    ];
    internalRepo.notify(SSEResultState.Features, features);
    const feat = internalRepo.feature("banana");
    await repo.release(false);
    expect(feat.getString()).toBe("yellow");
    const featuresNext: Array<FeatureState> = [
      { id: "1", key: "banana", version: 2, type: FeatureValueType.String, value: "orange" },
    ];
    internalRepo.notify(SSEResultState.Feature, featuresNext[0]);
    expect(feat.getString()).toBe("yellow");
    await repo.release(false);
    expect(feat.getString()).toBe("orange");
    internalRepo.notify(SSEResultState.Features, featuresNext);
    expect(feat.getString()).toBe("orange");
    await repo.release(false);
    expect(feat.getString()).toBe("orange");
  });

  it("should trigger when a new feature arrives", async () => {
    const repo: FeatureHubRepository = new ClientFeatureRepository();
    const internalRepo: InternalFeatureRepository = repo as InternalFeatureRepository;
    repo.catchAndReleaseMode = true;

    let counter = 0;
    repo.feature("orange").addListener(() => counter++);

    const features: Array<FeatureState> = [
      {
        id: "1",
        key: "banana",
        version: 1,
        type: FeatureValueType.Boolean,
        value: true,
      } as FeatureState,
    ];
    internalRepo.notify(SSEResultState.Features, features);

    internalRepo.notify(SSEResultState.Feature, {
      id: "1",
      key: "orange",
      version: 1,
      type: FeatureValueType.String,
    } as FeatureState);
    internalRepo.notify(SSEResultState.Feature, {
      id: "1",
      key: "orange",
      version: 2,
      type: FeatureValueType.String,
      value: "lemon",
    } as FeatureState);

    await repo.release(false);
    expect(repo.getString("orange")).toBe("lemon");
    expect(counter).toBe(2);
  });

  it("should enable me to turn on catch and no changes should flow and then i can release", async () => {
    const repo: FeatureHubRepository = new ClientFeatureRepository();
    const internalRepo: InternalFeatureRepository = repo as InternalFeatureRepository;
    let postNewTrigger = 0;
    repo.addPostLoadNewFeatureStateAvailableListener(() => postNewTrigger++);
    let bananaTrigger = 0;
    repo.getFeatureState("banana").addListener(() => bananaTrigger++);
    expect(postNewTrigger).toBe(0);
    expect(bananaTrigger).toBe(0);

    repo.catchAndReleaseMode = true;

    expect(repo.catchAndReleaseMode).toBe(true);

    const features = [
      {
        id: "1",
        key: "banana",
        version: 1,
        type: FeatureValueType.Boolean,
        value: true,
      } as FeatureState,
    ];

    internalRepo.notify(SSEResultState.Features, features);
    // change banana, change change banana
    internalRepo.notify(SSEResultState.Feature, {
      id: "1",
      key: "banana",
      version: 2,
      type: FeatureValueType.Boolean,
      value: false,
    } as FeatureState);
    expect(postNewTrigger).toBe(1);
    expect(bananaTrigger).toBe(1); // new list of features always trigger
    internalRepo.notify(SSEResultState.Feature, {
      id: "1",
      key: "banana",
      version: 3,
      type: FeatureValueType.Boolean,
      value: false,
    } as FeatureState);

    expect(postNewTrigger).toBe(2);
    expect(bananaTrigger).toBe(1);

    internalRepo.notify(SSEResultState.Feature, {
      id: "3",
      key: "apricot",
      version: 1,
      type: FeatureValueType.Boolean,
      value: false,
    } as FeatureState);
    expect(repo.feature("apricot").getBoolean()).toBeUndefined();

    expect(repo.getFeatureState("banana").getBoolean()).toBe(true);
    await repo.release();
    expect(repo.catchAndReleaseMode).toBe(true);
    expect(postNewTrigger).toBe(3);
    expect(bananaTrigger).toBe(2);
    expect(repo.getFeatureState("banana").getBoolean()).toBe(false);
    expect(repo.getFeatureState("apricot").getBoolean()).toBe(false);
    // notify with new state, should still hold
    const features2 = [
      {
        id: "1",
        key: "banana",
        version: 4,
        type: FeatureValueType.Boolean,
        value: true,
      } as FeatureState,
    ];

    internalRepo.notify(SSEResultState.Features, features2);
    expect(postNewTrigger).toBe(4);
    expect(bananaTrigger).toBe(2);
    expect(repo.getFlag("banana")).toBe(false);
    expect(repo.getFeatureState("banana").getVersion()).toBe(3);
    await repo.release(true);
    expect(repo.getFlag("banana")).toBe(true);
    expect(repo.getFeatureState("banana").getVersion()).toBe(4);
    // and now ensure c&r mode is off
    internalRepo.notify(SSEResultState.Feature, {
      id: "1",
      key: "banana",
      version: 5,
      type: FeatureValueType.Boolean,
      value: false,
    } as FeatureState);
    expect(repo.getFlag("banana")).toBe(false);
    expect(repo.getFeatureState("banana").getVersion()).toBe(5);
  });

  it("i have a features list, i delete in catch & release mode and it still exists until it is released", async () => {
    const repo: FeatureHubRepository = new ClientFeatureRepository();
    const internalRepo: InternalFeatureRepository = repo as InternalFeatureRepository;
    const features = [
      {
        id: "1",
        key: "banana",
        version: 1,
        type: FeatureValueType.Boolean,
        value: true,
      } as FeatureState,
    ];
    repo.catchAndReleaseMode = true;
    internalRepo.notify(SSEResultState.Features, features);
    expect(repo.feature("banana").exists).toBe(true);
    internalRepo.notify(SSEResultState.Features, []);
    expect(repo.feature("banana").exists).toBe(true);
    await repo.release();
    expect(repo.feature("banana").exists).toBe(false);
  });

  it("should allow be to turn on catch & release mode, get updated, remove the trigger and then not be notified with the trigger removed", async () => {
    const repo = new ClientFeatureRepository();
    let internal: InternalFeatureRepository | undefined = undefined;
    let eventTriggerCount = 0;
    repo.catchAndReleaseMode = true;
    const features = [
      {
        id: "1",
        key: "banana",
        version: 1,
        type: FeatureValueType.Boolean,
        value: true,
      } as FeatureState,
    ];
    repo.notify(SSEResultState.Features, features);
    const features2 = [
      {
        id: "1",
        key: "banana",
        version: 2,
        type: FeatureValueType.Boolean,
        value: false,
      } as FeatureState,
    ];
    repo.notify(SSEResultState.Features, features2);
    const handle = repo.addPostLoadNewFeatureStateAvailableListener((internalRepo) => {
      internal = internalRepo;
      eventTriggerCount++;
    });

    let listenerTriggerCount = 0;
    const postListener = () => {
      listenerTriggerCount++;
    };

    expect(internal).toBe(repo);
    expect(eventTriggerCount).toBe(1);
    await repo.release();
    repo.removePostLoadNewFeatureStateAvailableListener(handle);
    repo.removePostLoadNewFeatureStateAvailableListener(postListener);
    // reset the trigger counts to zero and then send updated data
    listenerTriggerCount = 0;
    eventTriggerCount = 0;
    repo.notify(SSEResultState.Features, []);
    // we didn't get notified
    expect(listenerTriggerCount).toBe(0);
    expect(eventTriggerCount).toBe(0);
  });
});

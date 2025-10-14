/* tslint:disable */
/* eslint-disable */
import {
  ClientFeatureRepository,
  FeatureHubRepository,
  FeatureState,
  FeatureValueType,
  SSEResultState,
} from "../app";
import { expect } from "chai";
import { InternalFeatureRepository } from "../app/internal_feature_repository";

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
    expect(feat.getString()).to.eq("yellow");
    const featuresNext: Array<FeatureState> = [
      { id: "1", key: "banana", version: 2, type: FeatureValueType.String, value: "orange" },
    ];
    internalRepo.notify(SSEResultState.Feature, featuresNext[0]);
    expect(feat.getString()).to.eq("yellow");
    await repo.release(false);
    expect(feat.getString()).to.eq("orange");
    internalRepo.notify(SSEResultState.Features, featuresNext);
    expect(feat.getString()).to.eq("orange");
    await repo.release(false);
    expect(feat.getString()).to.eq("orange");
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
    expect(repo.getString("orange")).to.eq("lemon");
    expect(counter).to.eq(2);
  });

  it("should enable me to turn on catch and no changes should flow and then i can release", async () => {
    const repo: FeatureHubRepository = new ClientFeatureRepository();
    const internalRepo: InternalFeatureRepository = repo as InternalFeatureRepository;
    let postNewTrigger = 0;
    repo.addPostLoadNewFeatureStateAvailableListener(() => postNewTrigger++);
    let bananaTrigger = 0;
    repo.getFeatureState("banana").addListener(() => bananaTrigger++);
    expect(postNewTrigger).to.eq(0);
    expect(bananaTrigger).to.eq(0);

    repo.catchAndReleaseMode = true;

    expect(repo.catchAndReleaseMode).to.eq(true);

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
    expect(postNewTrigger).to.eq(1);
    expect(bananaTrigger).to.eq(1); // new list of features always trigger
    internalRepo.notify(SSEResultState.Feature, {
      id: "1",
      key: "banana",
      version: 3,
      type: FeatureValueType.Boolean,
      value: false,
    } as FeatureState);

    expect(postNewTrigger).to.eq(2);
    expect(bananaTrigger).to.eq(1);

    internalRepo.notify(SSEResultState.Feature, {
      id: "3",
      key: "apricot",
      version: 1,
      type: FeatureValueType.Boolean,
      value: false,
    } as FeatureState);
    expect(repo.feature("apricot").getBoolean()).to.be.undefined;

    expect(repo.getFeatureState("banana").getBoolean()).to.eq(true);
    await repo.release();
    expect(repo.catchAndReleaseMode).to.eq(true);
    expect(postNewTrigger).to.eq(3);
    expect(bananaTrigger).to.eq(2);
    expect(repo.getFeatureState("banana").getBoolean()).to.eq(false);
    expect(repo.getFeatureState("apricot").getBoolean()).to.eq(false);
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
    expect(postNewTrigger).to.eq(4);
    expect(bananaTrigger).to.eq(2);
    expect(repo.getFlag("banana")).to.eq(false);
    expect(repo.getFeatureState("banana").getVersion()).to.eq(3);
    await repo.release(true);
    expect(repo.getFlag("banana")).to.eq(true);
    expect(repo.getFeatureState("banana").getVersion()).to.eq(4);
    // and now ensure c&r mode is off
    internalRepo.notify(SSEResultState.Feature, {
      id: "1",
      key: "banana",
      version: 5,
      type: FeatureValueType.Boolean,
      value: false,
    } as FeatureState);
    expect(repo.getFlag("banana")).to.eq(false);
    expect(repo.getFeatureState("banana").getVersion()).to.eq(5);
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
    expect(repo.feature("banana").exists).to.be.true;
    internalRepo.notify(SSEResultState.Features, []);
    expect(repo.feature("banana").exists).to.be.true;
    await repo.release();
    expect(repo.feature("banana").exists).to.be.false;
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

    expect(internal).to.eq(repo);
    expect(eventTriggerCount).to.eq(1);
    await repo.release();
    repo.removePostLoadNewFeatureStateAvailableListener(handle);
    repo.removePostLoadNewFeatureStateAvailableListener(postListener);
    // reset the trigger counts to zero and then send updated data
    listenerTriggerCount = 0;
    eventTriggerCount = 0;
    repo.notify(SSEResultState.Features, []);
    // we didn't get notified
    expect(listenerTriggerCount).to.eq(0);
    expect(eventTriggerCount).to.eq(0);
  });
});

import { Substitute } from "@fluffy-spoon/substitute";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ClientContext } from "../client_context";
import { ClientFeatureRepository } from "../client_feature_repository";
import { ServerEvalFeatureContext } from "../context_impl";
import { EdgeFeatureHubConfig } from "../edge_featurehub_config";
import type { EdgeServiceSupplier, FeatureHubConfig } from "../feature_hub_config";
import {
  type FeatureRolloutStrategy,
  type FeatureRolloutStrategyAttribute,
  FeatureValueType,
  RolloutStrategyAttributeConditional,
  RolloutStrategyFieldType,
  SSEResultState,
} from "../models";
import {
  DefaultUsagePlugin,
  setUsageConvertFunction,
  type UsageEvent,
  UsageEventWithFeature,
  UsageFeaturesCollectionContext,
} from "../usage/usage";
import { TestingContext } from "./testing_context";

class NeuteredServerEvalContext extends ServerEvalFeatureContext {
  override async build(): Promise<ClientContext> {
    // don't do anything
    return this;
  }
}

class NeuteredUsagePlugin extends DefaultUsagePlugin {
  public event: UsageEvent | undefined;

  override send(event: UsageEvent) {
    this.event = event;
  }
}

describe("usage plugin system works as expected", function () {
  let repo: ClientFeatureRepository;
  let usageStreamHandler: number;
  let event: UsageEvent | undefined = undefined;
  let eventCount = 0;
  let ctx: ClientContext;

  const fruitFeature = {
    id: "1",
    key: "fruit",
    version: 0,
    type: FeatureValueType.String,
    value: "pear",
    environmentId: "env1",
  };
  const boolFeature = {
    id: "2",
    key: "alive",
    version: 0,
    type: FeatureValueType.Boolean,
    value: true,
    environmentId: "nine-eggs-a-day",
  };
  const numberFeature = {
    id: "3",
    key: "fruitCount",
    version: 0,
    type: FeatureValueType.Number,
    value: 4,
    environmentId: "env1",
  };
  const jsonFeature = {
    id: "4",
    key: "fruitWarehouse",
    version: 0,
    type: FeatureValueType.Json,
    value: '{"warehouseId":6}',
    environmentId: "env1",
  };

  beforeEach(() => {
    repo = new ClientFeatureRepository();

    repo.notify(SSEResultState.Features, [fruitFeature, boolFeature, numberFeature, jsonFeature]);

    usageStreamHandler = -1;

    // the notify happened before listening to the stream
    eventCount = 0;
    event = undefined;
    usageStreamHandler = repo.registerUsageStream((e) => {
      console.log(JSON.stringify(e));
      event = e;
      eventCount++;
    });

    ctx = new TestingContext(repo);
  });

  afterEach(() => {
    if (usageStreamHandler !== -1) {
      repo.removeUsageStream(usageStreamHandler);
    }
  });

  it("evaluation check", () => {
    ctx.userKey("gorgon");
    expect(ctx.feature(fruitFeature.key).value).to.eq(fruitFeature.value);
    expect(eventCount).to.eq(1);
    expect(event).to.not.be.undefined;
    expect(event!.userKey).to.eq("gorgon");
    const evt = event! as UsageEventWithFeature;
    expect(evt.feature).to.not.be.undefined;
    expect(evt.feature.key).to.eq(fruitFeature.key);
    expect(evt.feature.id).to.eq(fruitFeature.id);
    expect(evt.feature.value).to.eq(fruitFeature.value);
  });

  it("should trigger full feature dump when features are delivered", () => {
    const userKey = "อ้วนจ๋า";
    // this one should automatically listen for
    ctx = new NeuteredServerEvalContext(
      repo,
      Substitute.for<EdgeServiceSupplier>(),
      Substitute.for<FeatureHubConfig>(),
    ).userKey(userKey);

    // the existing object is embedded in the feature, so we can't change it directly, we need to make a clone
    const newFruit = Object.assign({}, fruitFeature);
    newFruit.value = "orange";
    newFruit.version = newFruit.version++;

    repo.notify(SSEResultState.Features, [newFruit, boolFeature, numberFeature, jsonFeature]);

    expect(eventCount).to.eq(1);
    const evt = event! as UsageFeaturesCollectionContext;
    expect(evt.userKey).to.eq(userKey);
    expect(evt.contextAttributes["userkey"]).to.be.undefined;
    expect(evt.featureValues.length).to.eq(4);
    const fruit = evt.featureValues.find((f) => f.key === "fruit");
    expect(fruit).to.not.be.undefined;
    expect(fruit!.value).to.eq("orange");
  });

  it("should take into consideration the context and strategies when recording usage", () => {
    const userKey = "ออม";
    ctx.userKey(userKey);
    ctx.attributeValue("delight", true);

    const newBool = {
      id: "10",
      key: "smile",
      version: 0,
      type: FeatureValueType.Boolean,
      value: false,
      environmentId: "env1",
      strategies: [
        {
          id: "1",
          value: true,
          attributes: [
            {
              type: RolloutStrategyFieldType.Boolean,
              fieldName: "delight",
              values: [true],
              conditional: RolloutStrategyAttributeConditional.Equals,
            } as FeatureRolloutStrategyAttribute,
          ],
        } as FeatureRolloutStrategy,
      ],
    };

    repo.notify(SSEResultState.Feature, newBool);
    expect(ctx.feature("smile").value).to.eq(true);
    expect(eventCount).to.eq(1);
    const evt = event! as UsageEventWithFeature;
    expect(evt.feature.id).to.eq(newBool.id);
    expect(evt.feature.value).to.eq("on");
    expect(evt.feature.rawValue).to.be.true;
    expect(evt.feature.environmentId).to.eq("env1");
  });

  it("if we register a usage plugin with the edge config, it should render out the usage object correctly", () => {
    const fh = new EdgeFeatureHubConfig("http://localhost", "1234*567");
    // pre-set the repository to our one
    fh.repository(repo);
    const plugin = new NeuteredUsagePlugin();
    fh.addUsagePlugin(plugin);
    ctx.userKey("tofu").attributes = { boiled: true };

    // evaluate the feature
    expect(ctx.feature(boolFeature.key).value).to.be.true;
    expect(plugin.event).to.not.be.undefined;
    const data = plugin.event!.collectUsageRecord();
    expect(data["feature"]).to.eq(boolFeature.key);
    expect(data["id"]).to.eq(boolFeature.id);
    expect(data["value"]).to.eq("on");
    expect(data["boiled"]).to.eq(true);
    expect(data["environmentId"]).to.eq("nine-eggs-a-day");
  });

  describe("it should allow us to replace the default type converter", () => {
    afterEach(() => {
      // restore it
      setUsageConvertFunction(undefined);
    });

    it("should allow us to control how types are converted", () => {
      ctx.userKey("char-siu").attributeValue("dogBreeds", ["pomeranian", "golden retriever"]);

      setUsageConvertFunction((value, type) => {
        if (!value) return undefined;

        switch (type) {
          case FeatureValueType.Boolean:
            return value ? "yes" : "no";
          case FeatureValueType.Json:
            return JSON.parse(value);
          default:
            return value;
        }
      });

      // send the event
      ctx.recordNamedUsage("user-clicked", { mouse: "hole", tender: 23.4 });
      expect(eventCount).to.eq(1);

      // ensure the event is properly constructed
      expect(event instanceof UsageFeaturesCollectionContext).to.be.true;
      const evt = event! as UsageFeaturesCollectionContext;
      const f = (key: string) => {
        return evt.featureValues.find((f) => f.key === key);
      };
      const fruit = f(fruitFeature.key);
      const bool = f(boolFeature.key);
      const num = f(numberFeature.key);
      const json = f(jsonFeature.key);
      expect(fruit).to.not.be.undefined;
      expect(bool).to.not.be.undefined;
      expect(num).to.not.be.undefined;
      expect(json).to.not.be.undefined;
      expect(fruit?.value).to.eq(fruit?.value);
      expect(num?.value).to.eq(num?.value);
      expect(bool?.value).to.eq("yes");
      expect(json?.value).to.deep.eq({ warehouseId: 6 });

      expect(evt.userKey).to.eq("char-siu");
      expect(evt.contextAttributes).to.deep.eq({ dogBreeds: ["pomeranian", "golden retriever"] });
      expect(evt.eventName).to.eq("user-clicked");

      // ensure the even is properly converted
      const converted = evt.collectUsageRecord();
      expect(converted["mouse"]).to.eq("hole");
      expect(converted["tender"]).to.eq(23.4);
      expect(converted[fruitFeature.key]).to.eq(fruitFeature.value);
      expect(converted[numberFeature.key]).to.eq(numberFeature.value);
      expect(converted[jsonFeature.key]).to.deep.eq({ warehouseId: 6 });
      expect(converted[boolFeature.key]).to.eq("yes");
      expect(converted["dogBreeds"]).to.deep.eq(["pomeranian", "golden retriever"]);
    });
  });
});

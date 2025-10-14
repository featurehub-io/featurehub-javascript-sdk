import { CustomWorld } from "./world";

const { Before, After } = require("@cucumber/cucumber");
import { FeatureUpdater, FeatureStateUpdate, ClientContext } from "featurehub-javascript-node-sdk";
import { Config } from "./config";
import { expect } from "chai";
import waitForExpect from "wait-for-expect";

Before(function (details: any) {
  if (process.env.DEBUG) {
    console.log(`------------- (started ${details?.pickle?.name})`);
  }
});

After(function (details: any) {
  if (process.env.DEBUG) {
    console.log(`******* (finished ${details?.pickle?.name})`);
  }
});

Before({ tags: "@FEATURE_TITLE_TO_UPPERCASE" }, async function () {
  await (this as CustomWorld).updateFeature("FEATURE_TITLE_TO_UPPERCASE", true);
  await awaitCompletionOfChange((ctx: ClientContext) => {
    expect(ctx.feature("FEATURE_TITLE_TO_UPPERCASE").flag).to.eq(true);
  });
});

After({ tags: "@FEATURE_TITLE_TO_UPPERCASE" }, async function () {
  await (this as CustomWorld).updateFeature("FEATURE_TITLE_TO_UPPERCASE", false);
  await awaitCompletionOfChange((ctx: ClientContext) => {
    expect(ctx.feature("FEATURE_TITLE_TO_UPPERCASE").flag).to.eq(false);
  });
});

Before({ tags: "@FEATURE_TITLE_TO_UPPERCASE_OFF" }, async function () {
  await (this as CustomWorld).updateFeature("FEATURE_TITLE_TO_UPPERCASE", false);
  await awaitCompletionOfChange((ctx: ClientContext) => {
    expect(ctx.feature("FEATURE_TITLE_TO_UPPERCASE").flag).to.eq(false);
  });
});

Before({ tags: "@FEATURE_STRING_MILK" }, async function () {
  await (this as CustomWorld).updateFeature("FEATURE_STRING", "milk");
  await awaitCompletionOfChange((ctx: ClientContext) => {
    expect(ctx.feature("FEATURE_STRING").str).to.eq("milk");
  });
});

Before({ tags: "@FEATURE_STRING_BREAD" }, async function () {
  await (this as CustomWorld).updateFeature("FEATURE_STRING", "bread");
  await awaitCompletionOfChange((ctx: ClientContext) => {
    expect(ctx.feature("FEATURE_STRING").str).to.eq("bread");
  });
});

Before({ tags: "@FEATURE_STRING_MULTI" }, async function () {
  await (this as CustomWorld).updateFeature("FEATURE_STRING", "foo bar baz");
  await awaitCompletionOfChange((ctx: ClientContext) => {
    expect(ctx.feature("FEATURE_STRING").str).to.eq("foo bar baz");
  });
});

Before({ tags: "@FEATURE_STRING_EMPTY" }, async function () {
  await (this as CustomWorld).updateFeature("FEATURE_STRING", "");
  await awaitCompletionOfChange((ctx: ClientContext) => {
    expect(ctx.feature("FEATURE_STRING").isSet()).to.not.be.true;
  });
});

Before({ tags: "@FEATURE_STRING_NULL" }, async function () {
  await (this as CustomWorld).setFeatureToNotSet("FEATURE_STRING");
  await awaitCompletionOfChange((ctx: ClientContext) => {
    expect(ctx.feature("FEATURE_STRING").isSet()).to.not.be.true;
  });
});

Before({ tags: "@FEATURE_NUMBER_1" }, async function () {
  await (this as CustomWorld).updateFeature("FEATURE_NUMBER", 1);
  await awaitCompletionOfChange((ctx: ClientContext) => {
    expect(ctx.feature("FEATURE_NUMBER").num).to.eq(1);
  });
});

Before({ tags: "@FEATURE_NUMBER_DEC" }, async function () {
  await (this as CustomWorld).updateFeature("FEATURE_NUMBER", 507598.258978);
  await awaitCompletionOfChange((ctx: ClientContext) => {
    expect(ctx.feature("FEATURE_NUMBER").num).to.eq(507598.258978);
  });
});

async function awaitCompletionOfChange(expectFunc: (ctx: ClientContext) => void) {
  const ctx = await Config.fhConfig.newContext().build();

  const timeout = process.env.FEATUREHUB_POLLING_INTERVAL
    ? parseInt(process.env.FEATUREHUB_POLLING_INTERVAL) + 4000
    : 7000;
  await waitForExpect(
    async () => {
      expectFunc(ctx);
    },
    timeout,
    2000,
  );
}

Before({ tags: "@FEATURE_NUMBER_NEG" }, async function () {
  await (this as CustomWorld).updateFeature("FEATURE_NUMBER", -16746.43);
  await awaitCompletionOfChange((ctx: ClientContext) => {
    expect(ctx.feature("FEATURE_NUMBER").num).to.eq(-16746.43);
  });
});

Before({ tags: "@FEATURE_NUMBER_ZERO" }, async function () {
  await (this as CustomWorld).updateFeature("FEATURE_NUMBER", 0);
  await awaitCompletionOfChange((ctx: ClientContext) => {
    expect(ctx.feature("FEATURE_NUMBER").num).to.eq(0);
  });
});

Before({ tags: "@FEATURE_JSON_BAR" }, async function () {
  const json = JSON.stringify({ foo: "bar" });
  await (this as CustomWorld).updateFeature("FEATURE_JSON", json);
  await awaitCompletionOfChange((ctx: ClientContext) => {
    expect(ctx.feature("FEATURE_JSON").rawJson).to.eq(json);
  });
});

Before({ tags: "@FEATURE_JSON_BAZ" }, async function () {
  const json = JSON.stringify({ foo: "baz" });
  await (this as CustomWorld).updateFeature("FEATURE_JSON", json);
  await awaitCompletionOfChange((ctx: ClientContext) => {
    expect(ctx.feature("FEATURE_JSON").rawJson).to.eq(json);
  });
});

Before({ tags: "@FEATURE_NUMBER_NULL" }, async function () {
  await (this as CustomWorld).setFeatureToNotSet("FEATURE_NUMBER");
  await awaitCompletionOfChange((ctx: ClientContext) => {
    expect(ctx.feature("FEATURE_NUMBER").isSet()).to.not.be.true;
  });
});

Before({ tags: "@FEATURE_JSON_NULL" }, async function () {
  await (this as CustomWorld).setFeatureToNotSet("FEATURE_JSON");
  await awaitCompletionOfChange((ctx: ClientContext) => {
    expect(ctx.feature("FEATURE_JSON").isSet()).to.not.be.true;
  });
});

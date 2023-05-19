import { CustomWorld } from './world';

const {Before, After} = require("@cucumber/cucumber");
import {
  FeatureUpdater,
  FeatureStateUpdate,

} from "featurehub-javascript-node-sdk";
import { Config } from "./config";
import { expect } from "chai";

Before(function(details: any) {
  if (process.env.DEBUG) {
    console.log(`------------- (started ${details?.pickle?.name})`);
  }
});

After(function(details: any) {
  if (process.env.DEBUG) {
    console.log(`******* (finished ${details?.pickle?.name})`);
  }
});

Before({tags: "@FEATURE_TITLE_TO_UPPERCASE"}, async function () {
  await (this as CustomWorld).updateFeature('FEATURE_TITLE_TO_UPPERCASE', true);
});

After({tags: "@FEATURE_TITLE_TO_UPPERCASE"}, async function () {
  await (this as CustomWorld).updateFeature('FEATURE_TITLE_TO_UPPERCASE', false);
});

Before({tags: "@FEATURE_TITLE_TO_UPPERCASE_OFF"}, async function () {
  await (this as CustomWorld).updateFeature('FEATURE_TITLE_TO_UPPERCASE', false);
});

Before({tags: "@FEATURE_STRING_MILK"}, async function () {
  await (this as CustomWorld).updateFeature('FEATURE_STRING', 'milk');
});

Before({tags: "@FEATURE_STRING_BREAD"}, async function () {
  await (this as CustomWorld).updateFeature('FEATURE_STRING', 'bread');
});

Before({tags: "@FEATURE_STRING_MULTI"}, async function () {
  await (this as CustomWorld).updateFeature('FEATURE_STRING', 'foo bar baz');
});

Before({tags: "@FEATURE_STRING_EMPTY"}, async function () {
  await (this as CustomWorld).updateFeature('FEATURE_STRING', '');
});

Before({tags: "@FEATURE_STRING_NULL"}, async function () {
  await (this as CustomWorld).setFeatureToNotSet('FEATURE_STRING');
});

Before({tags: "@FEATURE_NUMBER_1"}, async function () {
  await (this as CustomWorld).updateFeature('FEATURE_NUMBER', 1);
});

Before({tags: "@FEATURE_NUMBER_DEC"}, async function () {
  await (this as CustomWorld).updateFeature('FEATURE_NUMBER', 507598.258978);
});

Before({tags: "@FEATURE_NUMBER_NEG"}, async function () {
  await (this as CustomWorld).updateFeature('FEATURE_NUMBER', -16746.43);
});

Before({tags: "@FEATURE_NUMBER_ZERO"}, async function () {
  await (this as CustomWorld).updateFeature('FEATURE_NUMBER', 0);
});

Before({tags: "@FEATURE_JSON_BAR"}, async function () {
  await (this as CustomWorld).updateFeature('FEATURE_JSON', JSON.stringify({foo: "bar"}));
});

Before({tags: "@FEATURE_JSON_BAZ"}, async function () {
  await (this as CustomWorld).updateFeature('FEATURE_JSON', JSON.stringify({foo: "baz"}));
});

Before({tags: "@FEATURE_NUMBER_NULL"}, async function () {
  await (this as CustomWorld).setFeatureToNotSet('FEATURE_NUMBER');
});

Before({tags: "@FEATURE_JSON_NULL"}, async function () {
  await (this as CustomWorld).setFeatureToNotSet('FEATURE_JSON');
});


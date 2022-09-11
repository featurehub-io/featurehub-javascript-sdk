const {Before, After } = require("@cucumber/cucumber");
import {
    FeatureUpdater,
    FeatureStateUpdate,

} from "featurehub-javascript-node-sdk";
import {Config} from "./config";
import {expect} from "chai";


Before({tags: "@FEATURE_TITLE_TO_UPPERCASE"}, async function () {
    await updateFeature('FEATURE_TITLE_TO_UPPERCASE', true);
});

After({tags: "@FEATURE_TITLE_TO_UPPERCASE"}, async function () {
    await updateFeature('FEATURE_TITLE_TO_UPPERCASE', false);
});

Before({tags: "@FEATURE_STRING_MILK"}, async function () {
    await updateFeature('FEATURE_STRING', 'milk');
});

Before({tags: "@FEATURE_STRING_BREAD"}, async function () {
    await updateFeature('FEATURE_STRING', 'bread');
});

Before({tags: "@FEATURE_STRING_MULTI"}, async function () {
    await updateFeature('FEATURE_STRING', 'foo bar baz');
});

Before({tags: "@FEATURE_STRING_EMPTY"}, async function () {
    await updateFeature('FEATURE_STRING', '');
});

Before({tags: "@FEATURE_STRING_NULL"}, async function () {
    await setFeatureToNotSet('FEATURE_STRING');
});


Before({tags: "@FEATURE_NUMBER_1"}, async function () {
    await updateFeature('FEATURE_NUMBER', 1);
});

Before({tags: "@FEATURE_NUMBER_DEC"}, async function () {
    await updateFeature('FEATURE_NUMBER', 507598.258978);
});

Before({tags: "@FEATURE_NUMBER_NEG"}, async function () {
    await updateFeature('FEATURE_NUMBER', -16746.43);
});

Before({tags: "@FEATURE_NUMBER_ZERO"}, async function () {
    await updateFeature('FEATURE_NUMBER', 0);
});

Before({tags: "@FEATURE_JSON_BAR"}, async function () {
    await updateFeature('FEATURE_JSON', JSON.stringify({foo: "bar"}));
});

Before({tags: "@FEATURE_JSON_BAZ"}, async function () {
    await updateFeature('FEATURE_JSON', JSON.stringify({foo: "baz"}));
});

Before({tags: "@FEATURE_NUMBER_NULL"}, async function () {
    await setFeatureToNotSet('FEATURE_NUMBER');
});

Before({tags: "@FEATURE_JSON_NULL"}, async function () {
    await setFeatureToNotSet('FEATURE_JSON');
});

async function updateFeature(name: string, newValue: any) {
    const featureUpdater = new FeatureUpdater(Config.fhConfig);
    const response = await featureUpdater.updateKey(name, {
        lock: false,
        value: newValue,
    } as FeatureStateUpdate);
    expect(response).to.equal(true);
}

async function setFeatureToNotSet(name: string) {
    const featureUpdater = new FeatureUpdater(Config.fhConfig);
    await featureUpdater.updateKey(name, {
        lock: false,
        updateValue: true
    } as FeatureStateUpdate);
}

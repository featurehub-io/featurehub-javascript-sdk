import { Configuration, Todo, TodoServiceApi } from "../../src/client-axios";
import { expect } from "chai";
import { Config } from "./config";
import waitForExpect from "wait-for-expect";
import { FeatureValueType } from 'featurehub-javascript-client-sdk';

const {Given, When, Then} = require("@cucumber/cucumber");

const todoApi = new TodoServiceApi(new Configuration({basePath: Config.baseApplicationPath}));

Given("I wipe my list of todos", async function () {
    await todoApi.removeAllTodos(this.user);
});

Then("my list of todos should contain {string}", async function (todoDescription: string) {
    async function extracted() {
        const response = await todoApi.listTodos(this.user);
        const responseData: Todo[] = response.data;
        console.log(`finding ${todoDescription} in`, responseData);
        const todo: Todo = responseData.find((item) => item.title === todoDescription);
        return {responseData, todo};
    }

    await waitForExpect(async () => {
        const {responseData, todo} = await extracted.call(this);
        console.log('compare', todo, responseData);
        expect(todo, `Expected ${todoDescription} but found in the response: ${responseData[0].title}`).to.exist;
    }, 20000, 1000);
});

Given("I have a user called {string}", function (userName: string) {
    this.setUser(userName);
});
When("I have added a new to-do item {string}", async function (todoDescription: string) {
    const todo: Todo = {
        id: '1',
        title: todoDescription,
    };
    await todoApi.addTodo(this.user, todo);
});

Given("I set the flag {string} to {string}", async function (featureKey: string, featureValue: string) {
    await this.unlockAndUpdateFeature(featureKey, featureValue);
});

Then("I should not be able to update the value", function () {
  expect(this.getFeatureUpdateResponse()).to.equal(false);
});

Given("I lock the feature {string}", async function (featureKey: string) {
  await this.lockFeature(featureKey);
});

When("I attempt to update feature {string} to boolean value {string}", async function (featureKey: string, value: boolean) {
  await this.updateFeatureOnlyValue(featureKey, value)
});

When("I attempt to update feature {string} to number value {string}", async function (featureKey: string, value: number) {
    await this.updateFeatureOnlyValue(featureKey, value)
});

When("I attempt to update feature {string} to string value {string}", async function (featureKey: string, value: string) {
    await this.updateFeatureOnlyValue(featureKey, value)
});
Then(/^feature (.*) is (locked|unlocked) and "([^"]*)"$/, async function (featureName: string, lockedStatus: string, value: string) {
  const locked = (lockedStatus === 'locked');
  const ctx = await Config.fhConfig.newContext().build();

  // has to be longer than the polling interval
  const timeout = process.env.FEATUREHUB_POLLING_INTERVAL ? (parseInt(process.env.FEATUREHUB_POLLING_INTERVAL) + 4000) : 7000;
  const interval = 500;
  let counter = 0;
  const self=this;

  await waitForExpect(async () => {
    const feature = ctx.feature(featureName);
    // we need to deal with the lock getting smacked because of optimistic locking, too many changes for
    // the same feature at the same time
    counter ++;
    if (((counter % 3) === 0) && (feature.locked !== locked)) {
      await self.justLockFeature(featureName, locked);
    }
    expect(feature.locked).to.eq(locked);
    switch (feature.type) {
      case FeatureValueType.Boolean:
        expect(feature.flag).to.eq(value === 'on');
        break;
      case FeatureValueType.String:
        expect(feature.str).to.eq(value);
        break;
      case FeatureValueType.Number:
        expect(feature.num).to.eq(parseFloat(value));
        break;
      case FeatureValueType.Json:
        expect(feature.rawJson).to.eq(value);
        break;
    }
  }, timeout, 500);
});

Given(/^I unlock feature (.*)$/, async function (featureKey: string) {
  await this.lockFeature(featureKey, false);
});

Given(/^the feature (.*) is (unlocked|locked)$/, async function (featureName: string, lockedStatus: string) {
  const locked = (lockedStatus === 'locked');
  const ctx = await Config.fhConfig.newContext().build();

  // has to be longer than the polling interval
  const timeout = process.env.FEATUREHUB_POLLING_INTERVAL ? (parseInt(process.env.FEATUREHUB_POLLING_INTERVAL) + 2000) : 4000;

  await waitForExpect(() => {
    const feature = ctx.feature(featureName);
    expect(feature.locked).to.eq(locked);
  }, timeout, 500);
});
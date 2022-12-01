import globalAxios, { AxiosResponse } from "axios";
import { FeatureStateUpdate, FeatureUpdater, FeatureStateHolder } from "featurehub-javascript-node-sdk";
import { Config } from "./config";
import { expect } from "chai";
import waitForExpect from "wait-for-expect";

const {AfterAll} = require("@cucumber/cucumber");

const {setWorldConstructor} = require("@cucumber/cucumber");
const {setDefaultTimeout} = require('@cucumber/cucumber');
setDefaultTimeout(30 * 1000);

AfterAll(async function () {
  Config.fhConfig.close();
});

export const responseToRecord = function (response: AxiosResponse) {
  const reqConfig = response.config;
  return {
    type: 'response',
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
    data: response.data,
    request: {
      headers: reqConfig.headers,
      method: reqConfig.method,
      data: reqConfig.data,
      url: reqConfig.url,
    }
  };
};

class CustomWorld {

  private variable: number;
  private user: string;
  private response: boolean;

  constructor() {
    this.variable = 0;
    globalAxios.interceptors.response.use((resp: AxiosResponse) => {
      const responseToLog = responseToRecord(resp);
      if (responseToLog !== undefined) {
        if (process.env.LOUD) {
          console.log(JSON.stringify(responseToLog, undefined, 2));
        } else {
          if (responseToLog.request.method.toLowerCase() !== 'get') {
            console.log(`${responseToLog.request.method.toUpperCase()} ${responseToLog.request.url} -> ${JSON.stringify(responseToLog.request.data)} ==> ${JSON.stringify(responseToLog.data)}`);
          }
          console.log(`GET ${responseToLog.request.url}: ${JSON.stringify(responseToLog.data, null, 2)}`);
        }
      }
      return resp;
    }, (error) => {
      if (error.response) {
        console.log(JSON.stringify(responseToRecord(error.response), undefined, 2));
      }
      return Promise.reject(error);
    });
  }

  setUser(user) {
    this.user = user;
  }

  async updateFeatureOnlyValue(name: string, newValue: any) {
    const featureUpdater = new FeatureUpdater(Config.fhConfig);
    this.response = await featureUpdater.updateKey(name, {
      value: newValue,
    } as FeatureStateUpdate);
    console.log(`Feature ${name}: new value ${newValue} (no lock change) : result ${this.response}`);
  }

  async lockFeature(name: string) {
    const featureUpdater = new FeatureUpdater(Config.fhConfig);
    this.response = await featureUpdater.updateKey(name, {
      lock: true,
    } as FeatureStateUpdate);
    console.log(`Feature ${name}: lock true, response is ${this.response}`);
    console.log(`Feature ${name}: waiting for lock to be true`);
    await waitForExpect(async () => {
      const feature: FeatureStateHolder = Config.fhConfig.repository().feature(name);
      console.log(`Lock is ${feature.isLocked()}`);
      expect(feature.isLocked()).to.equal(true);
    }, 10000, 1000);
  }

  async unlockAndUpdateFeature(name: string, newValue: any) {
    const featureUpdater = new FeatureUpdater(Config.fhConfig);
    this.response = await featureUpdater.updateKey(name, {
      lock: false,
      value: newValue,
    } as FeatureStateUpdate);
    console.log(`Feature ${name}: lock false, new value ${newValue}, response is ${this.response}`);
  }

  getFeatureUpdateResponse() {
    return this.response;
  }

}

setWorldConstructor(CustomWorld);

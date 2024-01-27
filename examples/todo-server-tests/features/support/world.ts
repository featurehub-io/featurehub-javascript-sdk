import globalAxios, {AxiosResponse, InternalAxiosRequestConfig} from "axios";
import {
  FeatureStateUpdate,
  FeatureUpdater,
  FeatureStateHolder, NodejsFeaturePostUpdater
} from "featurehub-javascript-node-sdk";
import { Config } from "./config";
import { expect } from "chai";
import waitForExpect from "wait-for-expect";
import {World} from "@cucumber/cucumber";

const {AfterAll} = require("@cucumber/cucumber");

const {setWorldConstructor} = require("@cucumber/cucumber");
const {setDefaultTimeout} = require('@cucumber/cucumber');
setDefaultTimeout(30 * 1000);

AfterAll(async function () {
  Config.fhConfig.close();
});

export function makeid(length: number) {
  let result = '';
  const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const charactersLength = characters.length;
  for (let i = 0; i < length; i++) {
    result += characters.charAt(Math.floor(Math.random() * charactersLength));
  }
  return result;
}

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

let requestId: number = 1;
const reqIdPrefix = (process.env.REQUEST_ID_PREFIX || '');

let world: CustomWorld | undefined = undefined;

globalAxios.interceptors.request.use((reqConfig: InternalAxiosRequestConfig) => {
  if (world) {
    reqConfig.headers['baggage'] = `cucumberScenarioId=${world.scenarioId};cuke-req-id=${reqIdPrefix}${requestId}`
  }

  return reqConfig;
}, (error) => Promise.reject(error));

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


export class CustomWorld extends World {
  private variable: number;
  private user: string;
  private response: boolean;
  public scenarioId: string;


  constructor(props: any) {
    super(props);
    this.variable = 0;
    world = this;
  }

  setScenarioId(scenId: string) {
    this.scenarioId = scenId;
    this.attach(`scenarioId=${this.scenarioId}`, 'text/plain');
  }

  setUser(user) {
    this.user = user;
  }

  async updateFeatureOnlyValue(name: string, newValue: any) {
    const featureUpdater = this.createFeatureUpdater();
    this.response = await featureUpdater.updateKey(name, {
      value: newValue,
    } as FeatureStateUpdate);
    console.log(`Feature ${name}: new value ${newValue} (no lock change) : result ${this.response}`);
  }

  async justLockFeature(name: string, locked: boolean = true) {
    const featureUpdater = this.createFeatureUpdater();
    this.response = await featureUpdater.updateKey(name, {
      lock: locked,
    } as FeatureStateUpdate);
    console.log(`Feature ${name}: lock true, response is ${this.response}`);
  }

  async lockFeature(name: string, locked: boolean = true) {
    const featureUpdater = this.createFeatureUpdater();
    const timeout = process.env.FEATUREHUB_POLLING_INTERVAL ? (parseInt(process.env.FEATUREHUB_POLLING_INTERVAL) + 4000) : 7000;
    const interval = 1000;
    let counter = 0;
    const self=this;
    this.response = await featureUpdater.updateKey(name, {
      lock: locked,
    } as FeatureStateUpdate);
    console.log(`Feature ${name}: lock true, response is ${this.response}`);
    console.log(`Feature ${name}: waiting for lock to be true`);
    const ctx = await Config.fhConfig.newContext().build();
    await waitForExpect(async () => {
      const feature: FeatureStateHolder = ctx.feature(name);
      console.log(`Lock is ${feature.isLocked()} vs ${locked}`);
      counter++;
      if ((counter % 2 == 0) && (feature.isLocked() !== locked)) { // might have failed due to a conflicting update
        await this.justLockFeature(name, locked);
      }
      expect(feature.isLocked()).to.equal(locked);
    }, timeout, interval);
  }

  createFeatureUpdater(): FeatureUpdater {
    const updater = new FeatureUpdater(Config.fhConfig);
    (updater.manager as NodejsFeaturePostUpdater).modifyRequestFunction = (req) => {
      req.headers['Baggage'] = `cucumberScenarioId=${this.scenarioId};cuke-req-id=${reqIdPrefix}${requestId}`;
      requestId ++;
    }
    return updater;
  }

  async unlockAndUpdateFeature(name: string, newValue: any) {
    const featureUpdater = this.createFeatureUpdater();
    this.response = await featureUpdater.updateKey(name, {
      lock: false,
      value: newValue,
    } as FeatureStateUpdate);
    console.log(`Feature ${name}: lock false, new value ${newValue}, response is ${this.response}`);
  }

  getFeatureUpdateResponse() {
    return this.response;
  }

  async updateFeature(name: string, newValue: any) {
    const featureUpdater = this.createFeatureUpdater();

    const response = await featureUpdater.updateKey(name, {
      lock: false,
      value: newValue,
    } as FeatureStateUpdate);
    console.log(`Feature ${name}: lock: false, new value ${newValue}, response is ${response}`);
    expect(response).to.equal(true);
  }

  async setFeatureToNotSet(name: string) {
    const featureUpdater = this.createFeatureUpdater();
    const response = await featureUpdater.updateKey(name, {
      lock: false,
      updateValue: true
    } as FeatureStateUpdate);
    console.log(`Feature ${name}: lock: false, clear feature, response is ${response}`);
  }


}

setWorldConstructor(CustomWorld);

import { AfterAll, setDefaultTimeout, setWorldConstructor, World } from "@cucumber/cucumber";
import globalAxios, { AxiosResponse, InternalAxiosRequestConfig } from "axios";
import { expect } from "chai";
import {
  FeatureUpdater,
  FeatureStateHolder,
  FeatureStateUpdate,
  fhLog,
} from "featurehub-javascript-node-sdk";
import waitForExpect from "wait-for-expect";

import { Config } from "./config";
import { IWorldOptions } from "@cucumber/cucumber/lib/support_code_library_builder/world";
setDefaultTimeout(30 * 1000);

AfterAll(async function () {
  Config.fhConfig.close();
});

const responseToRecord = (response: AxiosResponse) => {
  const reqConfig = response.config;
  return {
    type: "response",
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
    data: response.data,
    request: {
      headers: reqConfig.headers,
      method: reqConfig.method,
      data: reqConfig.data,
      url: reqConfig.url,
    },
  };
};

let requestId: number = 1;

export class CustomWorld extends World<any> {
  // @ts-expect-error - TODO: revisit this later
  private variable: number;
  // @ts-expect-error - TODO: revisit this later
  private user: string = "";
  private response: boolean = false;

  constructor({ attach, log, link, parameters }: IWorldOptions) {
    super({ attach, log, link, parameters });

    this.variable = 0;

    if (process.env["LOUD"]) {
      globalAxios.interceptors.request.use(
        (reqConfig: InternalAxiosRequestConfig) => {
          const req = {
            type: "request",
            headers: reqConfig.headers,
            method: reqConfig.method,
            data: reqConfig.data,
            url: reqConfig.url,
          };
          fhLog.log({
            level: "verbose",
            message: "request",
            http: JSON.stringify(req, undefined, 2),
          });
          return reqConfig;
        },
        (error) => Promise.reject(error),
      );
    }
    globalAxios.interceptors.response.use(
      (resp: AxiosResponse) => {
        const responseToLog = responseToRecord(resp);
        if (responseToLog !== undefined) {
          if (process.env["LOUD"]) {
            fhLog.log(JSON.stringify(responseToLog, undefined, 2));
          } else {
            if (responseToLog.request.method?.toLowerCase() !== "get") {
              fhLog.log(
                `${responseToLog.request.method?.toUpperCase()} ${
                  responseToLog.request.url
                } -> ${JSON.stringify(responseToLog.request.data)} ==> ${JSON.stringify(
                  responseToLog.data,
                )}`,
              );
            }
            fhLog.log(
              `GET ${responseToLog.request.url}: ${JSON.stringify(responseToLog.data, null, 2)}`,
            );
          }
        }
        return resp;
      },
      (error) => {
        if (error.response) {
          fhLog.error(JSON.stringify(responseToRecord(error.response), undefined, 2));
        }
        return Promise.reject(error);
      },
    );
  }

  increaseCukeId() {
    Config.cukeId++;
  }

  setUser(user: string) {
    this.user = user;
  }

  async updateFeatureOnlyValue(name: string, newValue: any) {
    const featureUpdater = this.addRequestIdHeaderToFeatureUpdater();
    this.response = await featureUpdater.updateKey(name, {
      value: newValue,
    } as FeatureStateUpdate);
    fhLog.log(`Feature ${name}: new value ${newValue} (no lock change) : result ${this.response}`);
  }

  async justLockFeature(name: string, locked: boolean = true) {
    const featureUpdater = this.addRequestIdHeaderToFeatureUpdater();
    this.response = await featureUpdater.updateKey(name, {
      lock: locked,
    } as FeatureStateUpdate);
    fhLog.log(`Feature ${name}: lock true, response is ${this.response}`);
  }

  async lockFeature(name: string, locked: boolean = true) {
    const pollingInterval = parseInt(process.env["FEATUREHUB_POLLING_INTERVAL"] || "0");
    const timeout = pollingInterval > 0 ? pollingInterval + 4000 : 7000;
    const interval = pollingInterval > 0 && pollingInterval < 1000 ? 500 : 1000;
    let counter = 0;

    await this.justLockFeature(name, locked);
    fhLog.log(
      `Feature ${name}: waiting for lock to be ${locked}, timeout is ${timeout} interval is ${interval}`,
    );
    const ctx = await Config.fhConfig.newContext().build();
    await waitForExpect(
      async () => {
        const feature: FeatureStateHolder = ctx.feature(name);
        fhLog.log(`Lock is ${feature.isLocked()} vs ${locked}`);
        counter++;
        if (counter % 3 == 0 && feature.isLocked() !== locked) {
          // might have failed due to a conflicting update
          await this.justLockFeature(name, locked);
        }
        expect(feature.isLocked()).to.equal(locked);
      },
      timeout,
      interval,
    );
  }

  addRequestIdHeaderToFeatureUpdater(): FeatureUpdater {
    const updater = new FeatureUpdater(Config.fhConfig);
    const world = this;

    updater.defaultOptions = {
      modifyRequestFunction: (req) => {
        const reqId = `${Config.reqIdPrefix}-${Config.cukeId}-${requestId}`;
        world.attach(`Feature Update ${reqId}`, "text/plain");
        req.headers["Baggage"] = `cuke-req-id=${reqId}`;
        requestId++;
      },
    };

    return updater;
  }

  async unlockAndUpdateFeature(name: string, newValue: any) {
    const featureUpdater = this.addRequestIdHeaderToFeatureUpdater();
    this.response = await featureUpdater.updateKey(name, {
      lock: false,
      value: newValue,
    } as FeatureStateUpdate);
    fhLog.log(`Feature ${name}: lock false, new value ${newValue}, response is ${this.response}`);
  }

  getFeatureUpdateResponse() {
    return this.response;
  }

  async updateFeature(name: string, newValue: any) {
    const featureUpdater = this.addRequestIdHeaderToFeatureUpdater();

    const response = await featureUpdater.updateKey(name, {
      lock: false,
      value: newValue,
    } as FeatureStateUpdate);
    fhLog.log(`Feature ${name}: lock: false, new value ${newValue}, response is ${response}`);
    expect(response).to.equal(true);
  }

  async setFeatureToNotSet(name: string) {
    const featureUpdater = this.addRequestIdHeaderToFeatureUpdater();
    const response = await featureUpdater.updateKey(name, {
      lock: false,
      updateValue: true,
    } as FeatureStateUpdate);
    fhLog.log(`Feature ${name}: lock: false, clear feature, response is ${response}`);
  }
}

setWorldConstructor(CustomWorld);

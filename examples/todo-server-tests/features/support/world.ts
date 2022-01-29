import globalAxios from "axios";
import { FeatureStateUpdate, FeatureUpdater, FeatureStateHolder } from "featurehub-javascript-node-sdk";
import { Config } from "./config";
import { expect } from "chai";
import waitForExpect from "wait-for-expect";
const { AfterAll } = require("@cucumber/cucumber");


const { setWorldConstructor } = require("@cucumber/cucumber");
const { setDefaultTimeout } = require('@cucumber/cucumber');
setDefaultTimeout(30 * 1000);


AfterAll(async function () {
    Config.fhConfig.close();
});

class CustomWorld {

    private variable: number;
    private user: string;
    private response: boolean;
    constructor() {
        this.variable = 0;
        globalAxios.interceptors.request.use(x=> {console.log(x); return x;}); // log axios requests
    }

    setUser(user) {
        this.user = user;
    }

    async updateFeatureOnlyValue(name: string, newValue: any) {
        const featureUpdater = new FeatureUpdater(Config.fhConfig);
        this.response =  await featureUpdater.updateKey(name, new FeatureStateUpdate({
            value: newValue,
        }));
    }

    async lockFeature(name: string) {
        const featureUpdater = new FeatureUpdater(Config.fhConfig);
        await featureUpdater.updateKey(name, new FeatureStateUpdate({
            lock: true,
        }));

        await waitForExpect(async () => { const feature: FeatureStateHolder = Config.fhConfig.repository().feature(name);
        expect(feature.isLocked()).to.equal(true);
        });
    }

    async unlockAndUpdateFeature(name: string, newValue: any) {
        const featureUpdater = new FeatureUpdater(Config.fhConfig);
        this.response =  await featureUpdater.updateKey(name, new FeatureStateUpdate({
            lock: false,
            value: newValue,
        }));
    }

    getFeatureUpdateResponse() {
        return this.response;
    }

}

setWorldConstructor(CustomWorld);

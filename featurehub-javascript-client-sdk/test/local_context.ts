/* tslint:disable */
/* eslint-disable */
import { expect } from "chai";
import {
  FeatureEnvironmentCollection,
  FeatureState,
  FeatureValueType,
  LocalClientContext,
} from "../app";

describe("Local context should be able to evaluate", () => {
  it("the ", () => {
    const context = new LocalClientContext({
      features: [
        {
          id: "1",
          key: "banana",
          version: 1,
          type: FeatureValueType.Boolean,
          value: true,
        } as FeatureState,
        {
          id: "2",
          key: "organge",
          version: 1,
          type: FeatureValueType.Boolean,
          value: false,
        } as FeatureState,
      ],
    } as FeatureEnvironmentCollection);

    expect(context.getBoolean("banana")).to.be.true;
    expect(context.getBoolean("organge")).to.be.false;
  });
});

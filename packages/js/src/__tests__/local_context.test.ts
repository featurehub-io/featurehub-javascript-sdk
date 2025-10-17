/* tslint:disable */
/* eslint-disable */
import { describe, it, expect } from "vitest";
import {
  type FeatureEnvironmentCollection,
  type FeatureState,
  FeatureValueType,
  LocalClientContext,
} from "../index";

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

    expect(context.getBoolean("banana")).toBe(true);
    expect(context.getBoolean("organge")).toBe(false);
  });
});

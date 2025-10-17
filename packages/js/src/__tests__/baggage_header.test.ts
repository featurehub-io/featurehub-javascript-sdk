/* tslint:disable */
/* eslint-disable */
import { Substitute } from "@fluffy-spoon/substitute";
import { describe, it, expect } from "vitest";
import { type FeatureHubRepository, w3cBaggageHeader } from "../index";

describe("baggage header should encode correctly", () => {
  it("should allow us to construct a baggage header", () => {
    const repo = Substitute.for<FeatureHubRepository>();

    const features = new Map<string, string | undefined>();
    features.set("FEATURE_STRING", "blah*&=blah");
    features.set("FEATURE_NUMBER", "17");
    features.set("FEATURE_BOOLEAN", "true");
    features.set("UNDEF", undefined);
    repo.simpleFeatures().returns(features);

    const val = w3cBaggageHeader({ repo: repo, header: "current-baggage" });

    expect(val).toBe(
      "current-baggage,fhub=FEATURE_STRING%3Dblah*%2526%253Dblah%2CFEATURE_NUMBER%3D17%2CFEATURE_BOOLEAN%3Dtrue%2CUNDEF%3D",
    );
  });

  it("we should be able to override the values", () => {
    const repo = Substitute.for<FeatureHubRepository>();

    const features = new Map<string, string | undefined>();
    features.set("FEATURE_STRING", "blah*&=blah");
    const values = new Map<string, string | undefined>();
    values.set("FEATURE_NUMBER", "17");
    values.set("FEATURE_BOOLEAN", "true");
    values.set("UNDEF", undefined);
    repo.simpleFeatures().returns(features);

    const val = w3cBaggageHeader({ repo: repo });

    expect(val).toBe("fhub=FEATURE_STRING%3Dblah*%2526%253Dblah");
  });

  it("if there are no features and no existing header the header should be undefined", () => {
    const repo = Substitute.for<FeatureHubRepository>();

    const features = new Map<string, string | undefined>();
    repo.simpleFeatures().returns(features);

    const val = w3cBaggageHeader({ repo: repo });
    expect(val).toBeUndefined();
  });

  it("we should preserve the header if there are no features", () => {
    const repo = Substitute.for<FeatureHubRepository>();

    const features = new Map<string, string | undefined>();
    repo.simpleFeatures().returns(features);

    const val = w3cBaggageHeader({ repo: repo, header: "sausage" });
    expect(val).toBe("sausage");
  });
});

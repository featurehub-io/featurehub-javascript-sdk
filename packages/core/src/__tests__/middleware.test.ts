import { Substitute } from "@fluffy-spoon/substitute";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  featurehubMiddleware,
  type FeatureStateHolder,
  FeatureValueType,
  type InternalFeatureRepository,
} from "../index";

describe("middleware decodes and provides face to repository", () => {
  beforeAll(() => {
    process.env["FEATUREHUB_ACCEPT_BAGGAGE"] = "true";
  });

  afterAll(() => {
    process.env["FEATUREHUB_ACCEPT_BAGGAGE"] = "";
  });

  it("baggage repository is decoded correctly and provides face", () => {
    const baggageHeader =
      "current-baggage,fhub=FEATURE_STRING%3Dblah*%2526%253Dblah%2CFEATURE_NUMBER%3D17%2CFEATURE_BOOLEAN%3Dtrue%2CUNDEF%3D";
    const req: any = {
      header: () => baggageHeader,
    };

    const fhRepo = Substitute.for<InternalFeatureRepository>();

    const sHolder = Substitute.for<FeatureStateHolder>();
    sHolder.getType().returns(FeatureValueType.String);
    sHolder.isLocked().returns(false);
    fhRepo.hasFeature("FEATURE_STRING").returns(sHolder);

    const bHolder = Substitute.for<FeatureStateHolder>();
    bHolder.getType().returns(FeatureValueType.Boolean);
    bHolder.isLocked().returns(false);
    fhRepo.hasFeature("FEATURE_BOOLEAN").returns(bHolder);

    const mw = featurehubMiddleware(fhRepo);

    let nextCalled = false;
    const next = function () {
      nextCalled = true;
    };

    const resp = {};

    mw(req, resp, next);

    expect(req.featureHub).toBeDefined();
    expect(nextCalled).toBe(true);
    const repo: InternalFeatureRepository = req.featureHub;
    expect(repo.feature("FEATURE_STRING").getString()).toBe("blah*&=blah");
    expect(repo.feature("FEATURE_STRING").str).toBe("blah*&=blah");
    expect(repo.feature("FEATURE_BOOLEAN").getBoolean()).toBe(true);
    expect(repo.feature("FEATURE_BOOLEAN").flag).toBe(true);
  });

  it("features that are locked cannot be overridden", () => {
    const baggageHeader =
      "current-baggage,fhub=FEATURE_STRING%3Dblah*%2526%253Dblah%2CFEATURE_NUMBER%3D17%2CFEATURE_BOOLEAN%3Dtrue%2CUNDEF%3D";
    const req: any = {
      header: () => baggageHeader,
    };

    const fhRepo = Substitute.for<InternalFeatureRepository>();

    const sHolder = Substitute.for<FeatureStateHolder>();
    sHolder.getType().returns(FeatureValueType.String);
    sHolder.getString().returns("pistachio");
    sHolder.isLocked().returns(true);
    fhRepo.hasFeature("FEATURE_STRING").returns(sHolder);

    const mw = featurehubMiddleware(fhRepo);

    const next = () => {};
    const resp = {};

    mw(req, resp, next);

    const repo: InternalFeatureRepository = req.featureHub;
    expect(repo.feature("FEATURE_STRING").getString()).toBe("pistachio");
  });
});

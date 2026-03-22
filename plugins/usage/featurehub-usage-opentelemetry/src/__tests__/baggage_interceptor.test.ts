import { Substitute } from "@fluffy-spoon/substitute";
import { describe, expect, it } from "vitest";

import type { FeatureHubRepository, FeatureState } from "featurehub-javascript-core-sdk";
import { FeatureValueType } from "featurehub-javascript-core-sdk";

import { OpenTelemetryFeatureInterceptor } from "../baggage_interceptor";

// Testable subclass that lets us inject a fake fhub baggage value
class TestableInterceptor extends OpenTelemetryFeatureInterceptor {
  private _fhub: string | undefined;

  constructor(fhub: string | undefined, allowOverrideLocked = false) {
    super(allowOverrideLocked);
    this._fhub = fhub;
  }

  protected override getBaggageEntry(): string | undefined {
    return this._fhub;
  }
}

function makeFeatureState(type: FeatureValueType, locked: boolean = false): FeatureState {
  return { id: "id1", key: "key", type, l: locked };
}

describe("OpenTelemetryFeatureInterceptor", () => {
  const repo = Substitute.for<FeatureHubRepository>();

  it("returns [false, undefined] when baggage has no fhub entry", () => {
    const interceptor = new TestableInterceptor(undefined);
    expect(interceptor.matched("MY_FLAG", repo)).toEqual([false, undefined]);
  });

  it("returns [false, undefined] when fhub is empty string", () => {
    const interceptor = new TestableInterceptor("");
    expect(interceptor.matched("MY_FLAG", repo)).toEqual([false, undefined]);
  });

  it("returns [false, undefined] when key is not in the baggage", () => {
    const interceptor = new TestableInterceptor("ALPHA=1,GAMMA=2");
    const fs = makeFeatureState(FeatureValueType.Number);
    expect(interceptor.matched("BETA", repo, fs)).toEqual([false, undefined]);
  });

  it("aborts early when current key is alphabetically greater than target key", () => {
    // GAMMA > BETA, so the loop exits before finding BETA
    const interceptor = new TestableInterceptor("ALPHA=1,GAMMA=2");
    const fs = makeFeatureState(FeatureValueType.Number);
    expect(interceptor.matched("BETA", repo, fs)).toEqual([false, undefined]);
  });

  it("converts a boolean flag from baggage", () => {
    const interceptor = new TestableInterceptor("MY_FLAG=true");
    const fs = makeFeatureState(FeatureValueType.Boolean);
    const [matched, value] = interceptor.matched("MY_FLAG", repo, fs);
    expect(matched).toBe(true);
    expect(value).toBe(true);
  });

  it("converts a false boolean flag from baggage", () => {
    const interceptor = new TestableInterceptor("MY_FLAG=false");
    const fs = makeFeatureState(FeatureValueType.Boolean);
    const [matched, value] = interceptor.matched("MY_FLAG", repo, fs);
    expect(matched).toBe(true);
    expect(value).toBe(false);
  });

  it("converts a number from baggage", () => {
    const interceptor = new TestableInterceptor("PRICE=3.14");
    const fs = makeFeatureState(FeatureValueType.Number);
    const [matched, value] = interceptor.matched("PRICE", repo, fs);
    expect(matched).toBe(true);
    expect(value).toBe(3.14);
  });

  it("converts a string from baggage", () => {
    const interceptor = new TestableInterceptor("BANNER=hello");
    const fs = makeFeatureState(FeatureValueType.String);
    const [matched, value] = interceptor.matched("BANNER", repo, fs);
    expect(matched).toBe(true);
    expect(value).toBe("hello");
  });

  it("url-decodes the value from baggage", () => {
    const interceptor = new TestableInterceptor("MSG=hello%20world");
    const fs = makeFeatureState(FeatureValueType.String);
    const [matched, value] = interceptor.matched("MSG", repo, fs);
    expect(matched).toBe(true);
    expect(value).toBe("hello world");
  });

  it("url-decodes json value from baggage", () => {
    const json = JSON.stringify({ a: 1, b: "two" });
    const interceptor = new TestableInterceptor(`CONFIG=${encodeURIComponent(json)}`);
    const fs = makeFeatureState(FeatureValueType.Json);
    const [matched, value] = interceptor.matched("CONFIG", repo, fs);
    expect(matched).toBe(true);
    expect(value).toBe(json);
  });

  it("returns [true, undefined] for a key with no value", () => {
    // key present without '=' means explicitly no value
    const interceptor = new TestableInterceptor("MY_FLAG");
    const fs = makeFeatureState(FeatureValueType.Boolean);
    expect(interceptor.matched("MY_FLAG", repo, fs)).toEqual([true, undefined]);
  });

  it("finds a key in the middle of an alphabetically ordered list", () => {
    const interceptor = new TestableInterceptor("ALPHA=1,BETA=2,GAMMA=3");
    const fs = makeFeatureState(FeatureValueType.Number);
    const [matched, value] = interceptor.matched("BETA", repo, fs);
    expect(matched).toBe(true);
    expect(value).toBe(2);
  });

  it("finds the first key in the list", () => {
    const interceptor = new TestableInterceptor("ALPHA=yes,BETA=no");
    const fs = makeFeatureState(FeatureValueType.Boolean);
    const [matched, value] = interceptor.matched("ALPHA", repo, fs);
    expect(matched).toBe(true);
    expect(value).toBe(true);
  });

  it("finds the last key in the list", () => {
    const interceptor = new TestableInterceptor("ALPHA=1,BETA=2,ZETA=99");
    const fs = makeFeatureState(FeatureValueType.Number);
    const [matched, value] = interceptor.matched("ZETA", repo, fs);
    expect(matched).toBe(true);
    expect(value).toBe(99);
  });

  it("does not override locked features by default", () => {
    const interceptor = new TestableInterceptor("MY_FLAG=true");
    const fs = makeFeatureState(FeatureValueType.Boolean, true);
    expect(interceptor.matched("MY_FLAG", repo, fs)).toEqual([false, undefined]);
  });

  it("overrides locked features when allowOverrideLocked is true", () => {
    const interceptor = new TestableInterceptor("MY_FLAG=true", true);
    const fs = makeFeatureState(FeatureValueType.Boolean, true);
    const [matched, value] = interceptor.matched("MY_FLAG", repo, fs);
    expect(matched).toBe(true);
    expect(value).toBe(true);
  });

  it("allows unlocked features to be overridden (default)", () => {
    const interceptor = new TestableInterceptor("MY_FLAG=false");
    const fs = makeFeatureState(FeatureValueType.Boolean, false);
    const [matched, value] = interceptor.matched("MY_FLAG", repo, fs);
    expect(matched).toBe(true);
    expect(value).toBe(false);
  });

  it("returns [false, undefined] when featureState is undefined and baggage key missing", () => {
    const interceptor = new TestableInterceptor("OTHER=1");
    expect(interceptor.matched("MY_FLAG", repo, undefined)).toEqual([false, undefined]);
  });
});

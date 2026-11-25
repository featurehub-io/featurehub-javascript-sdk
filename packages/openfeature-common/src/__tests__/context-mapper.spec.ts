import { describe, expect, it } from "vitest";

import {
  contextSignature,
  InvalidContextError,
  isClientEvaluatedKey,
  mapEvaluationContext,
  toContextRecord,
} from "../context-mapper";

describe("context mapping", () => {
  it("maps targetingKey to userkey and passes other attributes through", () => {
    expect(toContextRecord({ targetingKey: "u1", session: "s1", plan: "pro" })).toEqual({
      userkey: "u1",
      session: "s1",
      plan: "pro",
    });
  });

  // featurehub-protocol.yaml encoding.evaluation_context
  it("keeps session as session, the key FeatureHub's percentage rollouts use", () => {
    expect(toContextRecord({ targetingKey: "lingling", SESSION: "s1" })).toEqual({
      userkey: "lingling",
      session: "s1",
    });
  });

  it("recognises exactly the well-known keys case-insensitively, writing them lowercase", () => {
    expect(
      mapEvaluationContext({
        Country: "thailand",
        DEVICE: "mobile",
        Platform: "ios",
        Version: "1.2.0",
        Session: "s1",
      }).attributes,
    ).toEqual({
      country: "thailand",
      device: "mobile",
      platform: "ios",
      version: "1.2.0",
      session: "s1",
    });
  });

  it("passes any other key through with its case, email and sessionKey included", () => {
    expect(
      mapEvaluationContext({ Email: "orm@omu.co", sessionKey: "s1", KwongPastry: "mango" })
        .attributes,
    ).toEqual({ Email: "orm@omu.co", sessionKey: "s1", KwongPastry: "mango" });
  });

  it("drops fhubWhenActive, which only a strategy may hold", () => {
    expect(
      toContextRecord({
        targetingKey: "orm",
        fhubWhenActive: "2020-01-01T00:00:00Z",
        FHUBWHENACTIVE: "x",
      }),
    ).toEqual({ userkey: "orm" });
  });

  it("accepts date-times, alone and in lists", () => {
    const signedUp = new Date("2026-11-17T02:47:28Z");
    const visits = [signedUp, new Date("2026-12-01T09:00:00Z")];

    expect(toContextRecord({ targetingKey: "orm", signedUp, visits })).toEqual({
      userkey: "orm",
      signedUp,
      visits,
    });
  });

  it("keeps primitive arrays and skips nullish values", () => {
    expect(
      toContextRecord({ targetingKey: "u1", tags: ["a", "b"], ignored: null as never }),
    ).toEqual({ userkey: "u1", tags: ["a", "b"] });
  });

  it("rejects nested objects", () => {
    expect(() => mapEvaluationContext({ targetingKey: "u1", x: { a: 1 } })).toThrow(
      InvalidContextError,
    );
    expect(() => mapEvaluationContext({ targetingKey: "u1", x: [{ a: 1 }] })).toThrow(
      InvalidContextError,
    );
  });
});

describe("context signature", () => {
  it("is stable for equal contexts regardless of key order", () => {
    expect(contextSignature({ targetingKey: "u1", country: "NZ" })).toBe(
      contextSignature({ country: "NZ", targetingKey: "u1" }),
    );
  });

  it("changes when an attribute or the targeting key changes", () => {
    const base = contextSignature({ targetingKey: "u1", country: "NZ" });
    expect(contextSignature({ targetingKey: "u1", country: "AU" })).not.toBe(base);
    expect(contextSignature({ targetingKey: "u2", country: "NZ" })).not.toBe(base);
    expect(contextSignature({ targetingKey: "u1", country: "NZ", plan: "pro" })).not.toBe(base);
  });

  it("changes when a date-time changes", () => {
    expect(contextSignature({ signedUp: new Date("2026-11-17T02:47:28Z") })).not.toBe(
      contextSignature({ signedUp: new Date("2026-11-18T02:47:28Z") }),
    );
  });

  it("distinguishes an empty context from one with attributes", () => {
    expect(contextSignature(undefined)).not.toBe(contextSignature({ targetingKey: "u1" }));
    expect(contextSignature(undefined)).toBe(contextSignature({}));
  });
});

describe("key detection", () => {
  it("detects client-evaluated keys", () => {
    expect(isClientEvaluatedKey("*abc")).toBe(true);
    expect(isClientEvaluatedKey("default/env/serverkey")).toBe(false);
  });
});

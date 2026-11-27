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
    expect(toContextRecord({ targetingKey: "lingling", session: "chago", shop: "omu&co" })).toEqual(
      {
        userkey: "lingling",
        session: "chago",
        shop: "omu&co",
      },
    );
  });

  // featurehub-protocol.yaml encoding.evaluation_context
  it("keeps session as session, the key FeatureHub's percentage rollouts use", () => {
    expect(toContextRecord({ targetingKey: "lingling", SESSION: "chago" })).toEqual({
      userkey: "lingling",
      session: "chago",
    });
  });

  it("recognises exactly the well-known keys case-insensitively, writing them lowercase", () => {
    expect(
      mapEvaluationContext({
        Country: "thailand",
        DEVICE: "mobile",
        Platform: "ios",
        Version: "1.2.0",
        Session: "chago",
      }).attributes,
    ).toEqual({
      country: "thailand",
      device: "mobile",
      platform: "ios",
      version: "1.2.0",
      session: "chago",
    });
  });

  it("passes any other key through with its case, email and sessionKey included", () => {
    expect(
      mapEvaluationContext({ Email: "orm@omu.co", sessionKey: "chago", KwongPastry: "mango" })
        .attributes,
    ).toEqual({ Email: "orm@omu.co", sessionKey: "chago", KwongPastry: "mango" });
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
      toContextRecord({ targetingKey: "lingling", tags: ["ling", "orm"], ignored: null as never }),
    ).toEqual({ userkey: "lingling", tags: ["ling", "orm"] });
  });

  it("rejects nested objects", () => {
    expect(() => mapEvaluationContext({ targetingKey: "lingling", x: { a: 1 } })).toThrow(
      InvalidContextError,
    );
    expect(() => mapEvaluationContext({ targetingKey: "lingling", x: [{ a: 1 }] })).toThrow(
      InvalidContextError,
    );
  });
});

describe("context signature", () => {
  it("is stable for equal contexts regardless of key order", () => {
    expect(contextSignature({ targetingKey: "lingling", country: "thailand" })).toBe(
      contextSignature({ country: "thailand", targetingKey: "lingling" }),
    );
  });

  it("changes when an attribute or the targeting key changes", () => {
    const base = contextSignature({ targetingKey: "lingling", country: "thailand" });
    expect(contextSignature({ targetingKey: "lingling", country: "china" })).not.toBe(base);
    expect(contextSignature({ targetingKey: "orm", country: "thailand" })).not.toBe(base);
    expect(
      contextSignature({ targetingKey: "lingling", country: "thailand", shop: "omu&co" }),
    ).not.toBe(base);
  });

  it("changes when a date-time changes", () => {
    expect(contextSignature({ signedUp: new Date("2026-11-17T02:47:28Z") })).not.toBe(
      contextSignature({ signedUp: new Date("2026-11-18T02:47:28Z") }),
    );
  });

  it("tells apart lists and values that read the same as text", () => {
    expect(contextSignature({ tags: ["ling,orm"] })).not.toBe(
      contextSignature({ tags: ["ling", "orm"] }),
    );
    expect(contextSignature({ visits: 1 })).not.toBe(contextSignature({ visits: "1" }));
    expect(contextSignature({ tags: ["kwong"] })).not.toBe(contextSignature({ tags: "kwong" }));
  });

  it("distinguishes an empty context from one with attributes", () => {
    expect(contextSignature(undefined)).not.toBe(contextSignature({ targetingKey: "lingling" }));
    expect(contextSignature(undefined)).toBe(contextSignature({}));
  });
});

describe("key detection", () => {
  it("detects client-evaluated keys", () => {
    expect(isClientEvaluatedKey("*abc")).toBe(true);
    expect(isClientEvaluatedKey("default/env/serverkey")).toBe(false);
  });
});

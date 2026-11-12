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

  it("maps session to sessionkey only when server-eval mapping is requested", () => {
    expect(
      toContextRecord({ targetingKey: "u1", session: "s1" }, { sessionAsSessionKey: true }),
    ).toEqual({ userkey: "u1", sessionkey: "s1" });
  });

  it("maps a camelCase sessionKey to sessionkey under server-eval mapping", () => {
    // keys are lower-cased before the well-known-key lookup, so sessionKey
    // arrives as the recognised "sessionkey" attribute either way
    expect(
      toContextRecord({ targetingKey: "u1", sessionKey: "s1" }, { sessionAsSessionKey: true }),
    ).toEqual({ userkey: "u1", sessionkey: "s1" });
    expect(toContextRecord({ sessionKey: "s1" })).toEqual({ sessionkey: "s1" });
  });

  it("recognises well-known FeatureHub keys case-insensitively", () => {
    expect(mapEvaluationContext({ Country: "NZ", DEVICE: "iphone" }).attributes).toEqual({
      country: "NZ",
      device: "iphone",
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

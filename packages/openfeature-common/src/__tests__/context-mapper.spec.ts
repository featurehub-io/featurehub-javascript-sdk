import { describe, expect, it } from "vitest";

import {
  buildFeatureHubHeader,
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

describe("header + signature", () => {
  it("builds the sorted, URI-encoded x-featurehub header and uses it as the signature", () => {
    const context = { targetingKey: "u 1", country: "NZ", session: "s1" };
    const header = buildFeatureHubHeader(context);
    expect(header).toBe("country=NZ,sessionkey=s1,userkey=u%201");
    expect(contextSignature(context)).toBe(header);
  });

  it("joins array attributes with commas, matching caToString", () => {
    expect(buildFeatureHubHeader({ targetingKey: "u1", tags: ["a", "b"] })).toBe(
      "tags=a%2Cb,userkey=u1",
    );
  });
});

describe("key detection", () => {
  it("detects client-evaluated keys", () => {
    expect(isClientEvaluatedKey("*abc")).toBe(true);
    expect(isClientEvaluatedKey("default/env/serverkey")).toBe(false);
  });
});

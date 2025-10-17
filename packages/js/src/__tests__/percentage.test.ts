/* tslint:disable */
/* eslint-disable */
import { describe, it, expect } from "vitest";
import { Murmur3PercentageCalculator } from "../strategy_matcher";

describe("percentage checks", () => {
  it("should match other sdks", () => {
    expect(new Murmur3PercentageCalculator().determineClientPercentage("fred", "abcde")).toBe(
      212628,
    );
    expect(
      new Murmur3PercentageCalculator().determineClientPercentage(
        "zappo-food",
        "172765e02-2-1-1-2-2-1",
      ),
    ).toBe(931882);
  });
});

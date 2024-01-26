import {expect} from "chai";
import {Murmur3PercentageCalculator} from "../app/strategy_matcher";


describe('percentage checks', () => {
  it('should match other sdks', () => {
    expect(new Murmur3PercentageCalculator().determineClientPercentage("fred", "abcde")).to.eq(212628);
    expect(new Murmur3PercentageCalculator().determineClientPercentage("zappo-food", "172765e02-2-1-1-2-2-1")).to.eq(931882);
  });
});
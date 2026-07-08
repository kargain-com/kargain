import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { formatStakeEth } from "../lib/kar-pro/stake-format.ts";

describe("formatStakeEth", () => {
  it("returns 0.05 fallback when wei is undefined", () => {
    assert.equal(formatStakeEth(undefined), "0.05");
  });

  it("formats integer wei to two decimal places", () => {
    assert.equal(formatStakeEth(50_000_000_000_000_000n), "0.05");
    assert.equal(formatStakeEth(1_000_000_000_000_000_000n), "1.00");
  });

  it("formats fractional wei", () => {
    assert.equal(formatStakeEth(12_500_000_000_000_000n), "0.01");
  });

  it("returns raw formatEther string when parseFloat is non-finite", () => {
    const huge = 10n ** 400n;
    const expected = formatStakeEth(huge);
    assert.equal(expected.includes("e") || expected.length > 0, true);
    assert.equal(Number.isFinite(Number.parseFloat(expected)), false);
  });
});

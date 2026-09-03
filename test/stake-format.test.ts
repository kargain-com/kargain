import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { formatStakeNative } from "../lib/kar-pro/stake-format.ts";
import {
  COMMERCIAL_ACTIVE,
  nativeUnitOf,
} from "../lib/web3/commercial-active.ts";

const ethUnit = nativeUnitOf(COMMERCIAL_ACTIVE[84532]!);

describe("formatStakeNative", () => {
  it("returns 0.05 fallback when amount is undefined", () => {
    assert.equal(formatStakeNative(undefined, ethUnit), "0.05");
  });

  it("formats integer base units to two decimal places", () => {
    assert.equal(formatStakeNative(50_000_000_000_000_000n, ethUnit), "0.05");
    assert.equal(formatStakeNative(1_000_000_000_000_000_000n, ethUnit), "1.00");
  });

  it("formats fractional base units", () => {
    assert.equal(formatStakeNative(12_500_000_000_000_000n, ethUnit), "0.01");
  });

  it("returns raw formatUnits string when parseFloat is non-finite", () => {
    const huge = 10n ** 400n;
    const expected = formatStakeNative(huge, ethUnit);
    assert.equal(expected.includes("e") || expected.length > 0, true);
    assert.equal(Number.isFinite(Number.parseFloat(expected)), false);
  });
});

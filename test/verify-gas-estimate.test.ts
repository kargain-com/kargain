import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  VERIFY_PASSPORT_GAS_UNITS,
  verifyGasCostWei,
} from "../lib/verifier/verify-gas-estimate.ts";

describe("verifyGasCostWei", () => {
  it("multiplies gas units by max fee per gas", () => {
    assert.equal(verifyGasCostWei(100_000n, 1_000_000_000n), 100_000_000_000_000n);
  });

  it("returns zero for non-positive inputs", () => {
    assert.equal(verifyGasCostWei(0n, 1_000n), 0n);
    assert.equal(verifyGasCostWei(100n, 0n), 0n);
  });
});

describe("VERIFY_PASSPORT_GAS_UNITS", () => {
  it("is 110_000", () => {
    assert.equal(VERIFY_PASSPORT_GAS_UNITS, 110_000n);
  });
});

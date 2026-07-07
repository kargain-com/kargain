import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  formatVerificationFee,
  verificationFeeInUsdc,
  verificationFeeToUsd1e8,
} from "../lib/verifier/verification-fee.ts";

const ETH_USD_3000 = 300_000_000_000n;
const FEE_005_ETH = 50_000_000_000_000_000n;

describe("formatVerificationFee", () => {
  it("returns contact copy for zero fee", () => {
    assert.equal(formatVerificationFee(0n), "Contact for quote");
  });

  it("formats positive wei as ETH", () => {
    assert.equal(formatVerificationFee(FEE_005_ETH), "0.05 ETH");
  });
});

describe("verificationFeeToUsd1e8", () => {
  it("returns zero for non-positive fee or rate", () => {
    assert.equal(verificationFeeToUsd1e8(0n, ETH_USD_3000), 0n);
    assert.equal(verificationFeeToUsd1e8(FEE_005_ETH, 0n), 0n);
    assert.equal(verificationFeeToUsd1e8(-1n, ETH_USD_3000), 0n);
  });

  it("converts 0.05 ETH at $3000 to USD 1e8", () => {
    assert.equal(verificationFeeToUsd1e8(FEE_005_ETH, ETH_USD_3000), 150_000_000_00n);
  });

  it("rounds down on remainder", () => {
    const feeWei = 1n;
    const ethUsd = 300_000_000_000n;
    const usd = verificationFeeToUsd1e8(feeWei, ethUsd);
    assert.equal(usd, (feeWei * ethUsd) / 10n ** 18n);
    assert.equal(usd, 0n);
  });
});

describe("verificationFeeInUsdc", () => {
  it("returns zero when fee is zero", () => {
    assert.equal(verificationFeeInUsdc(0n, ETH_USD_3000), 0n);
  });

  it("returns zero when ethUsd rate is zero", () => {
    assert.equal(verificationFeeInUsdc(FEE_005_ETH, 0n), 0n);
  });

  it("converts wei fee to USDC 1e6 using ethUsd at 1e8", () => {
    assert.equal(
      verificationFeeInUsdc(FEE_005_ETH, ETH_USD_3000),
      150_000_000n,
    );
  });
});

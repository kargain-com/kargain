import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { verificationFeeInSats } from "../lib/verifier/verification-fee.ts";

const ETH_USD_3000 = 300_000_000_000n;
const BTC_USD_70K = 7_000_000_000_000n;
const FEE_005_ETH = 50_000_000_000_000_000n;

describe("verificationFeeInSats", () => {
  it("returns zero when any input is zero", () => {
    assert.equal(verificationFeeInSats(0n, ETH_USD_3000, BTC_USD_70K), 0n);
    assert.equal(verificationFeeInSats(FEE_005_ETH, 0n, BTC_USD_70K), 0n);
    assert.equal(verificationFeeInSats(FEE_005_ETH, ETH_USD_3000, 0n), 0n);
  });

  it("rounds up remainder", () => {
    assert.equal(
      verificationFeeInSats(FEE_005_ETH, ETH_USD_3000, BTC_USD_70K),
      214_286n,
    );
  });

  it("computes sats for 0.004 ETH fee", () => {
    const feeWei = 4_000_000_000_000_000n; // 0.004 ETH
    assert.equal(
      verificationFeeInSats(feeWei, ETH_USD_3000, BTC_USD_70K),
      17_143n,
    );
  });
});

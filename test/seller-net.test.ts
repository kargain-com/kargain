import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  computeSellerNet,
  satisfiesOwnerMin,
  sellerNetSatisfied,
} from "../lib/marketplace/seller-net.ts";

describe("computeSellerNet", () => {
  it("matches contract fee arithmetic at 10 bps platform and 500 bps agent", () => {
    const price = 100_000_000_000n; // 1000 USD @ 1e8
    const { agentFee, platformFee, sellerNet } = computeSellerNet(price, 500, 10n);
    assert.equal(agentFee, 5_000_000_000n);
    assert.equal(platformFee, 100_000_000n);
    assert.equal(sellerNet, 94_900_000_000n);
  });

  it("seller net equals price minus both fees", () => {
    const price = 50_000_000_000n;
    const { agentFee, platformFee, sellerNet } = computeSellerNet(price, 1000, 10n);
    assert.equal(sellerNet, price - agentFee - platformFee);
  });
});

describe("satisfiesOwnerMin", () => {
  it("passes when seller net equals minimum", () => {
    assert.equal(satisfiesOwnerMin(90_000_000_000n, 90_000_000_000n), true);
  });

  it("passes when seller net is above minimum", () => {
    assert.equal(satisfiesOwnerMin(90_000_000_001n, 90_000_000_000n), true);
  });

  it("fails when seller net is below minimum", () => {
    assert.equal(satisfiesOwnerMin(89_999_999_999n, 90_000_000_000n), false);
  });
});

describe("sellerNetSatisfied", () => {
  const ownerMin = 90_000_000_000n;
  const platformBps = 10n;

  it("returns false for null price", () => {
    assert.equal(sellerNetSatisfied(null, 500, platformBps, ownerMin), false);
  });

  it("returns false when commission exceeds max bps", () => {
    assert.equal(
      sellerNetSatisfied(100_000_000_000n, 3001, platformBps, ownerMin),
      false,
    );
  });

  it("returns true when net meets owner minimum", () => {
    assert.equal(
      sellerNetSatisfied(100_000_000_000n, 500, platformBps, ownerMin),
      true,
    );
  });

  it("returns false when net is below owner minimum", () => {
    assert.equal(
      sellerNetSatisfied(95_000_000_000n, 2000, platformBps, ownerMin),
      false,
    );
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseEther, zeroAddress } from "viem";

import {
  claimCreditLine,
  claimNotificationBody,
  explainClaimFromCredits,
} from "../lib/claims/explain-credits.ts";

const NATIVE_DISPLAY = { decimals: 18, symbol: null, nativeSymbol: "ETH" };

describe("explainClaimFromCredits", () => {
  it("explains a single-origin claim with amount and reason", () => {
    const text = explainClaimFromCredits(
      [
        {
          amount: parseEther("1"),
          reasonCode: "auction.outbid_refund",
          asset: zeroAddress,
        },
      ],
      NATIVE_DISPLAY,
    );
    assert.match(text, /1 ETH/);
    assert.match(text, /auction bid refund/i);
    assert.equal(text.includes("\n"), false);
  });

  it("accounts for two different origins in one balance", () => {
    const text = explainClaimFromCredits(
      [
        {
          amount: 100n,
          reasonCode: "auction.outbid_refund",
          asset: zeroAddress,
        },
        {
          amount: 50n,
          reasonCode: "auction.settlement_payout",
          asset: zeroAddress,
        },
      ],
      { decimals: null, symbol: null, nativeSymbol: "ETH" },
    );
    const lines = text.split("\n");
    assert.equal(lines.length, 2);
    assert.match(lines[0]!, /100 ETH/);
    assert.match(lines[0]!, /auction bid refund/i);
    assert.match(lines[1]!, /50 ETH/);
    assert.match(lines[1]!, /auction sale payout/i);
  });

  it("keeps duplicate reasons as separate lines", () => {
    const text = explainClaimFromCredits(
      [
        {
          amount: 10n,
          reasonCode: "marketplace.settlement_payout",
          asset: zeroAddress,
        },
        {
          amount: 20n,
          reasonCode: "marketplace.settlement_payout",
          asset: zeroAddress,
        },
      ],
      { decimals: null, symbol: null, nativeSymbol: "ETH" },
    );
    assert.equal(text.split("\n").length, 2);
  });

  it("falls back when credits are empty", () => {
    assert.match(explainClaimFromCredits([]), /waiting for you to withdraw/i);
  });
});

describe("claimNotificationBody", () => {
  it("describes this credit only with amount and reason", () => {
    const body = claimNotificationBody({
      amount: parseEther("0.05"),
      asset: zeroAddress,
      reasonCode: "staking.stake_refund",
      decimals: 18,
      nativeSymbol: "ETH",
    });
    assert.match(body, /0\.05 ETH/);
    assert.match(body, /KarPro stake refund/i);
    assert.equal(claimCreditLine(
      { amount: parseEther("0.05"), reasonCode: "staking.stake_refund", asset: zeroAddress },
      NATIVE_DISPLAY,
    ), body);
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { zeroAddress } from "viem";

import { claimCreditId, pendingClaimId } from "../lib/claims/ids.ts";
import {
  claimReasonExplanation,
  inferClaimReason,
  normalizeTxSelector,
} from "../lib/claims/reason.ts";
import {
  claimRecordedCreditRow,
  claimRecordedNotificationItems,
  pendingClaimAfterCredit,
  pendingClaimAfterWithdraw,
} from "../src/lib/ponder-claims.ts";

describe("claim ids", () => {
  it("builds four-tuple pending claim id", () => {
    assert.equal(
      pendingClaimId({
        chainId: 84532,
        contract: "0xAbcDef0000000000000000000000000000000001",
        account: "0x1111111111111111111111111111111111111111",
        asset: zeroAddress,
      }),
      "84532-0xabcdef0000000000000000000000000000000001-0x1111111111111111111111111111111111111111-0x0000000000000000000000000000000000000000",
    );
  });

  it("builds claim credit id", () => {
    assert.equal(
      claimCreditId("0xABCDEF", 3),
      "0xabcdef-3",
    );
  });
});

describe("inferClaimReason", () => {
  it("maps auction bid selector to outbid refund", () => {
    assert.equal(
      inferClaimReason({
        role: "auction",
        txInput: "0x4cafdb15" + "00".repeat(64),
      }),
      "auction.outbid_refund",
    );
  });

  it("maps staking claimStake", () => {
    assert.equal(
      inferClaimReason({ role: "staking", txInput: "0xeb321173" }),
      "staking.stake_refund",
    );
  });

  it("falls back by role when selector unknown", () => {
    assert.equal(
      inferClaimReason({ role: "marketplace", txInput: "0xdeadbeef" }),
      "marketplace.settlement_payout",
    );
  });

  it("returns unknown without role", () => {
    assert.equal(inferClaimReason({ role: null }), "unknown");
  });

  it("normalizes short input to null", () => {
    assert.equal(normalizeTxSelector("0x12"), null);
  });
});

describe("claimReasonExplanation", () => {
  it("explains unknown honestly", () => {
    assert.match(claimReasonExplanation("unknown"), /waiting for you to withdraw/i);
  });
});

describe("ponder claim projection", () => {
  const account = "0x1111111111111111111111111111111111111111";
  const contract = "0x2222222222222222222222222222222222222222";

  it("credits accumulate and withdraw zeros", () => {
    const credit1 = claimRecordedCreditRow({
      chainId: 84532,
      contract,
      account,
      asset: zeroAddress,
      amount: 100n,
      role: "auction",
      txInput: "0x4cafdb15",
      txHash: "0xaaa",
      logIndex: 0,
      timestamp: 10n,
    });
    assert.equal(credit1.reasonCode, "auction.outbid_refund");

    const bal1 = pendingClaimAfterCredit({ existing: null, credit: credit1 });
    assert.equal(bal1.amount, 100n);

    const credit2 = claimRecordedCreditRow({
      chainId: 84532,
      contract,
      account,
      asset: zeroAddress,
      amount: 50n,
      role: "auction",
      txInput: "0x4d68282f",
      txHash: "0xbbb",
      logIndex: 1,
      timestamp: 20n,
    });
    const bal2 = pendingClaimAfterCredit({ existing: bal1, credit: credit2 });
    assert.equal(bal2.amount, 150n);
    assert.equal(bal2.reasonCode, "auction.settlement_payout");
    assert.equal(bal2.firstCreditedAt, 10n);

    const cleared = pendingClaimAfterWithdraw({ existing: bal2, timestamp: 30n });
    assert.equal(cleared.amount, 0n);
    assert.equal(cleared.updatedAt, 30n);
  });

  it("notification items filter by recipient and since", () => {
    const credit = claimRecordedCreditRow({
      chainId: 84532,
      contract,
      account,
      asset: zeroAddress,
      amount: 1n,
      role: "staking",
      txInput: "0xeb321173",
      txHash: "0xccc",
      logIndex: 2,
      timestamp: 50n,
    });
    const items = claimRecordedNotificationItems([credit], account, 40n);
    assert.equal(items.length, 1);
    assert.equal(items[0]!.type, "claim.recorded");
    assert.equal(claimRecordedNotificationItems([credit], account, 50n).length, 0);
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { AuctionSettlement } from "@/lib/auction/map-ponder-auction";
import type { OnChainHold } from "@/lib/auction/parse-on-chain-auction";
import {
  deriveSettlementUiState,
  isSettlementPollActive,
  mergeSettlementSnapshot,
} from "@/lib/auction/settlement-state";

const BUYER = "0x1111111111111111111111111111111111111111";
const ZERO = "0x0000000000000000000000000000000000000000";

function settlement(
  overrides: Partial<AuctionSettlement> = {},
): AuctionSettlement {
  return {
    buyer: BUYER,
    gross: 2_400_000_000_000_000_000n,
    releaseAt: 1_700_000_000n,
    disputedAt: null,
    bond: 0n,
    disputeOutcome: "",
    receiptConfirmedAt: null,
    platformFee: 0n,
    agentFee: 0n,
    net: 0n,
    autoRelease: false,
    releasedAt: null,
    refundPendingAt: null,
    clearedAt: null,
    ...overrides,
  };
}

function hold(overrides: Partial<OnChainHold> = {}): OnChainHold {
  return {
    buyer: BUYER as `0x${string}`,
    gross: 2_400_000_000_000_000_000n,
    releaseAt: 1_700_000_000n,
    disputedAt: 0n,
    bond: 0n,
    refundPendingAt: 0n,
    open: true,
    ...overrides,
  };
}

const TIMEOUT = 30n * 24n * 60n * 60n; // 30 days

describe("deriveSettlementUiState", () => {
  it("returns NONE when no settlement and no open hold", () => {
    assert.equal(
      deriveSettlementUiState({
        settlement: null,
        hold: null,
        nowSec: 1_700_000_000,
        disputeResolutionTimeoutSec: TIMEOUT,
      }),
      "NONE",
    );
    assert.equal(
      deriveSettlementUiState({
        settlement: null,
        hold: { ...hold({ releaseAt: 0n }), open: false },
        nowSec: 1_700_000_000,
        disputeResolutionTimeoutSec: TIMEOUT,
      }),
      "NONE",
    );
  });

  it("HOLD before releaseAt", () => {
    assert.equal(
      deriveSettlementUiState({
        settlement: settlement({ releaseAt: 1_700_000_100n }),
        hold: null,
        nowSec: 1_700_000_000,
        disputeResolutionTimeoutSec: TIMEOUT,
      }),
      "HOLD",
    );
  });

  it("HOLD_RELEASABLE at and after releaseAt with no dispute", () => {
    const releaseAt = 1_700_000_000n;
    assert.equal(
      deriveSettlementUiState({
        settlement: settlement({ releaseAt }),
        hold: null,
        nowSec: releaseAt,
        disputeResolutionTimeoutSec: TIMEOUT,
      }),
      "HOLD_RELEASABLE",
    );
    assert.equal(
      deriveSettlementUiState({
        settlement: settlement({ releaseAt }),
        hold: null,
        nowSec: releaseAt + 1n,
        disputeResolutionTimeoutSec: TIMEOUT,
      }),
      "HOLD_RELEASABLE",
    );
    assert.equal(
      deriveSettlementUiState({
        settlement: settlement({ releaseAt }),
        hold: null,
        nowSec: releaseAt - 1n,
        disputeResolutionTimeoutSec: TIMEOUT,
      }),
      "HOLD",
    );
  });

  it("DISPUTED when dispute open and before timeout", () => {
    const disputedAt = 1_700_000_000n;
    assert.equal(
      deriveSettlementUiState({
        settlement: settlement({
          disputedAt,
          bond: 10_000_000_000_000_000n,
        }),
        hold: null,
        nowSec: disputedAt + TIMEOUT - 1n,
        disputeResolutionTimeoutSec: TIMEOUT,
      }),
      "DISPUTED",
    );
  });

  it("DISPUTE_TIMED_OUT at and after disputedAt + timeout", () => {
    const disputedAt = 1_700_000_000n;
    const deadline = disputedAt + TIMEOUT;
    assert.equal(
      deriveSettlementUiState({
        settlement: settlement({ disputedAt }),
        hold: null,
        nowSec: deadline,
        disputeResolutionTimeoutSec: TIMEOUT,
      }),
      "DISPUTE_TIMED_OUT",
    );
    assert.equal(
      deriveSettlementUiState({
        settlement: settlement({ disputedAt }),
        hold: null,
        nowSec: deadline + 1n,
        disputeResolutionTimeoutSec: TIMEOUT,
      }),
      "DISPUTE_TIMED_OUT",
    );
    assert.equal(
      deriveSettlementUiState({
        settlement: settlement({ disputedAt }),
        hold: null,
        nowSec: deadline - 1n,
        disputeResolutionTimeoutSec: TIMEOUT,
      }),
      "DISPUTED",
    );
  });

  it("REFUND_PENDING when refundPendingAt set (precedes dispute timeout)", () => {
    assert.equal(
      deriveSettlementUiState({
        settlement: settlement({
          disputedAt: 1_700_000_000n,
          refundPendingAt: 1_700_000_050n,
          disputeOutcome: "ConfirmFailure",
        }),
        hold: null,
        nowSec: 1_800_000_000,
        disputeResolutionTimeoutSec: TIMEOUT,
      }),
      "REFUND_PENDING",
    );
  });

  it("RELEASED when releasedAt set", () => {
    assert.equal(
      deriveSettlementUiState({
        settlement: settlement({
          releasedAt: 1_700_000_200n,
          platformFee: 1n,
          agentFee: 2n,
          net: 3n,
        }),
        hold: null,
        nowSec: 1_800_000_000,
        disputeResolutionTimeoutSec: TIMEOUT,
      }),
      "RELEASED",
    );
  });

  it("CLEARED precedes RELEASED", () => {
    assert.equal(
      deriveSettlementUiState({
        settlement: settlement({
          releasedAt: 1_700_000_200n,
          clearedAt: 1_700_000_300n,
        }),
        hold: null,
        nowSec: 1_800_000_000,
        disputeResolutionTimeoutSec: TIMEOUT,
      }),
      "CLEARED",
    );
  });

  it("chain hold wins on live timestamps when open", () => {
    const state = deriveSettlementUiState({
      settlement: settlement({
        releaseAt: 1_700_000_000n,
        disputedAt: null,
      }),
      hold: hold({
        releaseAt: 1_700_000_000n,
        disputedAt: 1_700_000_050n,
        bond: 10_000_000_000_000_000n,
      }),
      nowSec: 1_700_000_060,
      disputeResolutionTimeoutSec: TIMEOUT,
    });
    assert.equal(state, "DISPUTED");
  });

  it("mergeSettlementSnapshot prefers chain when open", () => {
    const snap = mergeSettlementSnapshot(
      settlement({ gross: 1n, releaseAt: 100n }),
      hold({ gross: 99n, releaseAt: 200n, buyer: ZERO as `0x${string}` }),
    );
    assert.ok(snap);
    assert.equal(snap.gross, 99n);
    assert.equal(snap.releaseAt, 200n);
    assert.equal(snap.buyer.toLowerCase(), ZERO.toLowerCase());
  });
});

describe("isSettlementPollActive", () => {
  it("true only for HOLD, DISPUTED, REFUND_PENDING", () => {
    assert.equal(isSettlementPollActive("HOLD"), true);
    assert.equal(isSettlementPollActive("DISPUTED"), true);
    assert.equal(isSettlementPollActive("REFUND_PENDING"), true);
    assert.equal(isSettlementPollActive("HOLD_RELEASABLE"), false);
    assert.equal(isSettlementPollActive("DISPUTE_TIMED_OUT"), false);
    assert.equal(isSettlementPollActive("RELEASED"), false);
    assert.equal(isSettlementPollActive("CLEARED"), false);
    assert.equal(isSettlementPollActive("NONE"), false);
  });
});

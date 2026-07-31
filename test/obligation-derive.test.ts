/**
 * Outstanding-obligation derivation — one answer for panel + feed.
 *
 * Named scenarios: protection, challenge active/elapsed, reversal,
 * standing bid, recall, paused+open, fail-closed unresolved,
 * judge vs party_excluded vs recorded_verifier, approaching threshold.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  APPROACHING_DEADLINE_SECONDS,
  approachingNotificationId,
  approachingNotificationKind,
  deriveOutstandingObligations,
  isApproachingDeadline,
  outstandingCount,
  type ObligationFacts,
} from "@/lib/obligation";
import { RECALL_COOLDOWN_SECONDS } from "@/lib/commerce/recall";

const BUYER = "0x5555555555555555555555555555555555555555";
const SELLER = "0x6666666666666666666666666666666666666666";
const AGENT = "0x7777777777777777777777777777777777777777";
const CHALLENGER = "0x3333333333333333333333333333333333333333";
const OWNER = "0x1111111111111111111111111111111111111111";
const VERIFIER = "0x2222222222222222222222222222222222222222";
const JUDGE = "0x4444444444444444444444444444444444444444";
const BIDDER = "0x8888888888888888888888888888888888888888";
const MODE = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const NOW = 1_700_000_000;
const WINDOW = 14 * 24 * 60 * 60;
const CHAIN = 84532;

function emptyFacts(overrides: Partial<ObligationFacts> = {}): ObligationFacts {
  return {
    unresolved: false,
    consignments: [],
    holds: [],
    bids: [],
    challenges: [],
    passports: [],
    modes: [],
    ...overrides,
  };
}

function heldConsignment(tokenId = "42") {
  return {
    id: `${CHAIN}-ascending-${tokenId}`,
    chainId: CHAIN,
    mode: "ascending" as const,
    modeContract: MODE,
    tokenId,
    seller: SELLER,
    agent: AGENT,
    buyer: BUYER,
    phase: "held",
    recallRequestedAt: null,
  };
}

function activeHold(tokenId = "42", protectionEndsAt = NOW + 3 * 24 * 60 * 60) {
  return {
    id: `${CHAIN}-${tokenId}`,
    consignmentId: `${CHAIN}-ascending-${tokenId}`,
    chainId: CHAIN,
    tokenId,
    buyer: BUYER,
    gross: "1000000000000000000",
    protectionEndsAt,
    state: "active",
    abandonmentDeadline: null,
  };
}

describe("deriveOutstandingObligations — fail closed", () => {
  it("facts_unresolved never becomes empty ready", () => {
    const result = deriveOutstandingObligations(emptyFacts({ unresolved: true }), {
      address: BUYER,
      nowSec: NOW,
      isActiveVerifier: false,
    });
    assert.equal(result.status, "unresolved");
    assert.equal(outstandingCount(result), null);
  });

  it("missing wallet is unresolved", () => {
    const result = deriveOutstandingObligations(emptyFacts(), {
      address: undefined,
      nowSec: NOW,
      isActiveVerifier: false,
    });
    assert.equal(result.status, "unresolved");
    assert.equal(result.reason, "no_wallet");
  });

  it("open challenges + unread verifier → judgeEligibilityUnresolved; count null", () => {
    const result = deriveOutstandingObligations(
      emptyFacts({
        challenges: [
          {
            id: "c1",
            chainId: CHAIN,
            instance: "passport",
            instanceContract: MODE,
            subjectId: "9",
            challenger: CHALLENGER,
            bondAmount: "1",
            windowDuration: WINDOW,
            openedAt: NOW,
            status: "open",
          },
        ],
        passports: [
          {
            tokenId: "9",
            chainId: CHAIN,
            owner: OWNER,
            status: "DISPUTED",
            verifier: VERIFIER,
            disputeOpenedAt: NOW,
            lastDisputer: CHALLENGER,
          },
        ],
      }),
      { address: JUDGE, nowSec: NOW + 60, isActiveVerifier: undefined },
    );
    assert.equal(result.status, "ready");
    assert.equal(result.judgeEligibilityUnresolved, true);
    assert.equal(outstandingCount(result), null);
  });
});

describe("protection_hold", () => {
  it("buyer sees protection hold with protectionEndsAt deadline", () => {
    const ends = NOW + 2 * 24 * 60 * 60;
    const result = deriveOutstandingObligations(
      emptyFacts({
        consignments: [heldConsignment()],
        holds: [activeHold("42", ends)],
      }),
      { address: BUYER, nowSec: NOW, isActiveVerifier: false },
    );
    assert.equal(result.status, "ready");
    const item = result.items.find((i) => i.kind === "protection_hold");
    assert.ok(item);
    assert.equal(item.role, "buyer");
    assert.equal(item.deadlineSec, ends);
    assert.equal(item.settlementState, "HOLD");
    assert.match(item.consequence, /Confirm receipt|bonded challenge/i);
  });

  it("seller also gets protection_hold awareness while hold is active", () => {
    const result = deriveOutstandingObligations(
      emptyFacts({
        consignments: [heldConsignment()],
        holds: [activeHold()],
      }),
      { address: SELLER, nowSec: NOW, isActiveVerifier: false },
    );
    assert.ok(result.items.some((i) => i.kind === "protection_hold" && i.role === "seller"));
  });
});

describe("reversal_pending", () => {
  it("buyer reversal uses abandonment deadline + REVERSAL consequence", () => {
    const abandon = NOW + 10 * 24 * 60 * 60;
    const result = deriveOutstandingObligations(
      emptyFacts({
        consignments: [heldConsignment()],
        holds: [
          {
            ...activeHold(),
            state: "reversalStarted",
            abandonmentDeadline: abandon,
          },
        ],
      }),
      { address: BUYER, nowSec: NOW, isActiveVerifier: false },
    );
    const item = result.items.find((i) => i.kind === "reversal_pending");
    assert.ok(item);
    assert.equal(item.deadlineSec, abandon);
    assert.equal(item.settlementState, "REVERSAL_PENDING");
    assert.match(item.consequence, /abandon|seller is paid/i);
  });
});

describe("settlement + verification challenge", () => {
  it("challenger gets settlement_challenge while window active", () => {
    const result = deriveOutstandingObligations(
      emptyFacts({
        consignments: [heldConsignment()],
        holds: [activeHold()],
        challenges: [
          {
            id: "asc-1",
            chainId: CHAIN,
            instance: "ascending",
            instanceContract: MODE,
            subjectId: "42",
            challenger: BUYER,
            bondAmount: "1",
            windowDuration: WINDOW,
            openedAt: NOW,
            status: "open",
          },
        ],
      }),
      { address: BUYER, nowSec: NOW + 60, isActiveVerifier: false },
    );
    const item = result.items.find(
      (i) => i.kind === "settlement_challenge" && i.role === "challenger",
    );
    assert.ok(item);
    assert.equal(item.challengePhase, "active");
    assert.equal(item.deadlineSec, NOW + WINDOW);
    // Hold row suppressed while challenge open.
    assert.equal(result.items.some((i) => i.kind === "protection_hold"), false);
  });

  it("elapsed challenge: conclude-only copy; no eligible_judge", () => {
    const opened = NOW - WINDOW - 10;
    const result = deriveOutstandingObligations(
      emptyFacts({
        challenges: [
          {
            id: "p1",
            chainId: CHAIN,
            instance: "passport",
            instanceContract: MODE,
            subjectId: "9",
            challenger: CHALLENGER,
            bondAmount: "1",
            windowDuration: WINDOW,
            openedAt: opened,
            status: "open",
          },
        ],
        passports: [
          {
            tokenId: "9",
            chainId: CHAIN,
            owner: OWNER,
            status: "DISPUTED",
            verifier: VERIFIER,
            disputeOpenedAt: opened,
            lastDisputer: CHALLENGER,
          },
        ],
      }),
      { address: JUDGE, nowSec: NOW, isActiveVerifier: true },
    );
    assert.equal(
      result.items.some((i) => i.role === "eligible_judge"),
      false,
    );
    const ownerView = deriveOutstandingObligations(
      emptyFacts({
        challenges: [
          {
            id: "p1",
            chainId: CHAIN,
            instance: "passport",
            instanceContract: MODE,
            subjectId: "9",
            challenger: CHALLENGER,
            bondAmount: "1",
            windowDuration: WINDOW,
            openedAt: opened,
            status: "open",
          },
        ],
        passports: [
          {
            tokenId: "9",
            chainId: CHAIN,
            owner: OWNER,
            status: "DISPUTED",
            verifier: VERIFIER,
            disputeOpenedAt: opened,
            lastDisputer: CHALLENGER,
          },
        ],
      }),
      { address: OWNER, nowSec: NOW, isActiveVerifier: false },
    );
    const ownerItem = ownerView.items.find((i) => i.role === "owner");
    assert.ok(ownerItem);
    assert.equal(ownerItem.challengePhase, "elapsed");
  });

  it("independent active verifier → eligible_judge; recorded verifier is not judge", () => {
    const facts = emptyFacts({
      challenges: [
        {
          id: "p1",
          chainId: CHAIN,
          instance: "passport",
          instanceContract: MODE,
          subjectId: "9",
          challenger: CHALLENGER,
          bondAmount: "1",
          windowDuration: WINDOW,
          openedAt: NOW,
          status: "open",
        },
      ],
      passports: [
        {
          tokenId: "9",
          chainId: CHAIN,
          owner: OWNER,
          status: "DISPUTED",
          verifier: VERIFIER,
          disputeOpenedAt: NOW,
          lastDisputer: CHALLENGER,
        },
      ],
    });

    const judge = deriveOutstandingObligations(facts, {
      address: JUDGE,
      nowSec: NOW + 60,
      isActiveVerifier: true,
    });
    assert.ok(judge.items.some((i) => i.role === "eligible_judge"));

    const recorded = deriveOutstandingObligations(facts, {
      address: VERIFIER,
      nowSec: NOW + 60,
      isActiveVerifier: true,
    });
    assert.ok(recorded.items.some((i) => i.role === "recorded_verifier"));
    assert.equal(
      recorded.items.some((i) => i.role === "eligible_judge"),
      false,
    );
    assert.match(
      recorded.items.find((i) => i.role === "recorded_verifier")!.consequence,
      /cannot judge/i,
    );
  });
});

describe("standing_bid + recall + paused", () => {
  it("unrefunded bid on binding lot → standing_bid", () => {
    const ends = NOW + 3 * 24 * 60 * 60;
    const result = deriveOutstandingObligations(
      emptyFacts({
        consignments: [
          {
            id: `${CHAIN}-ascending-7`,
            chainId: CHAIN,
            mode: "ascending",
            modeContract: MODE,
            tokenId: "7",
            seller: SELLER,
            agent: "0x0000000000000000000000000000000000000000",
            buyer: "",
            phase: "binding",
            recallRequestedAt: null,
          },
        ],
        bids: [
          {
            id: "b1",
            consignmentId: `${CHAIN}-ascending-7`,
            chainId: CHAIN,
            tokenId: "7",
            bidder: BIDDER,
            amount: "1",
            endsAt: ends,
            refunded: false,
            timestamp: NOW,
          },
        ],
      }),
      { address: BIDDER, nowSec: NOW, isActiveVerifier: false },
    );
    const item = result.items.find((i) => i.kind === "standing_bid");
    assert.ok(item);
    assert.equal(item.deadlineSec, ends);
    assert.equal(item.role, "bidder");
  });

  it("recall_cooldown for seller from recallRequestedAt + labelled cooldown", () => {
    const requested = NOW - 60;
    const result = deriveOutstandingObligations(
      emptyFacts({
        consignments: [
          {
            id: `${CHAIN}-fixed-3`,
            chainId: CHAIN,
            mode: "fixedPrice",
            modeContract: MODE,
            tokenId: "3",
            seller: SELLER,
            agent: AGENT,
            buyer: "",
            phase: "offered",
            recallRequestedAt: requested,
          },
        ],
      }),
      { address: SELLER, nowSec: NOW, isActiveVerifier: false },
    );
    const item = result.items.find((i) => i.kind === "recall_cooldown");
    assert.ok(item);
    assert.equal(
      item.deadlineSec,
      requested + Number(RECALL_COOLDOWN_SECONDS),
    );
  });

  it("mode_paused_open when paused and party has live consignment", () => {
    const result = deriveOutstandingObligations(
      emptyFacts({
        consignments: [
          {
            id: `${CHAIN}-ascending-1`,
            chainId: CHAIN,
            mode: "ascending",
            modeContract: MODE,
            tokenId: "1",
            seller: SELLER,
            agent: "0x0000000000000000000000000000000000000000",
            buyer: "",
            phase: "binding",
            recallRequestedAt: null,
          },
        ],
        modes: [{ chainId: CHAIN, modeContract: MODE, paused: true }],
      }),
      { address: SELLER, nowSec: NOW, isActiveVerifier: false },
    );
    assert.ok(result.items.some((i) => i.kind === "mode_paused_open"));
  });
});

describe("approaching deadline", () => {
  it("isApproachingDeadline within 48h; stable notification id", () => {
    const ends = NOW + 12 * 60 * 60;
    const result = deriveOutstandingObligations(
      emptyFacts({
        consignments: [heldConsignment()],
        holds: [activeHold("42", ends)],
      }),
      { address: BUYER, nowSec: NOW, isActiveVerifier: false },
    );
    const item = result.items.find((i) => i.kind === "protection_hold")!;
    assert.equal(isApproachingDeadline(item, NOW), true);
    assert.equal(
      isApproachingDeadline(item, NOW, APPROACHING_DEADLINE_SECONDS),
      true,
    );
    assert.equal(
      approachingNotificationKind(item),
      "commerce.protection_closing",
    );
    assert.equal(
      approachingNotificationId(
        "commerce.protection_closing",
        item.subjectId,
        ends,
      ),
      `commerce.protection_closing:${item.subjectId}:${ends}`,
    );
  });

  it("outside 48h is not approaching; no deadline never approaches", () => {
    const ends = NOW + 3 * 24 * 60 * 60;
    const result = deriveOutstandingObligations(
      emptyFacts({
        consignments: [heldConsignment()],
        holds: [activeHold("42", ends)],
      }),
      { address: BUYER, nowSec: NOW, isActiveVerifier: false },
    );
    const item = result.items.find((i) => i.kind === "protection_hold")!;
    assert.equal(isApproachingDeadline(item, NOW), false);

    const paused = deriveOutstandingObligations(
      emptyFacts({
        consignments: [
          {
            id: `${CHAIN}-ascending-1`,
            chainId: CHAIN,
            mode: "ascending",
            modeContract: MODE,
            tokenId: "1",
            seller: SELLER,
            agent: "0x0000000000000000000000000000000000000000",
            buyer: "",
            phase: "offered",
            recallRequestedAt: null,
          },
        ],
        modes: [{ chainId: CHAIN, modeContract: MODE, paused: true }],
      }),
      { address: SELLER, nowSec: NOW, isActiveVerifier: false },
    );
    const pausedItem = paused.items.find((i) => i.kind === "mode_paused_open")!;
    assert.equal(isApproachingDeadline(pausedItem, NOW), false);
    assert.equal(approachingNotificationKind(pausedItem), null);
  });
});

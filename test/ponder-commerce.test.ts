import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getAddress, zeroAddress } from "viem";

import {
  ALL_COMMERCE_PHASES,
  COMMERCE_PHASE,
  CLOSE_REASON,
  LIVE_PHASES,
  OPEN_PHASES,
  REQUIRED_CLAIM_CAUSE_EVENTS,
  bidExtended,
  causeFromBidRefunded,
  causeFromChallengeTerminal,
  causesFromSplitPaid,
  challengeId,
  challengeOpenedRow,
  commerceClaimAfterCredit,
  commerceClaimAfterWithdraw,
  commerceClaimCreditRow,
  consignmentId,
  consignmentOpenedRow,
  correlateClaimReason,
  mandateGrantedRow,
  mandateId,
  nextSaleOrdinal,
  phaseAfterClose,
} from "../src/lib/ponder-commerce.ts";

const MODE = "0x1111111111111111111111111111111111111111" as const;
const SELLER = "0x2222222222222222222222222222222222222222" as const;
const AGENT = "0x3333333333333333333333333333333333333333" as const;
const TX = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as const;

describe("ponder-commerce identity", () => {
  it("consignmentId is append-only log identity", () => {
    const id = consignmentId({
      chainId: 31337,
      modeContract: MODE,
      tokenId: 1n,
      txHash: TX,
      logIndex: 4,
    });
    assert.equal(
      id,
      `31337-${MODE.toLowerCase()}-1-${TX.toLowerCase()}-4`,
    );
  });

  it("saleOrdinal is prior count + 1", () => {
    assert.equal(nextSaleOrdinal(0), 1);
    assert.equal(nextSaleOrdinal(2), 3);
  });

  it("mandateId is per mode contract + token", () => {
    assert.equal(
      mandateId({ chainId: 84532, modeContract: MODE, tokenId: 99n }),
      `84532-${MODE.toLowerCase()}-99`,
    );
  });

  it("challengeId includes instance contract", () => {
    const id = challengeId({
      chainId: 84532,
      instanceContract: MODE,
      subjectId: 5n,
      txHash: TX,
      logIndex: 1,
    });
    assert.match(id, /^84532-/);
    assert.ok(id.includes("-5-"));
  });
});

describe("ponder-commerce phase machine", () => {
  it("OPEN_PHASES are buyable; LIVE_PHASES add held custody", () => {
    assert.deepEqual([...OPEN_PHASES].sort(), ["binding", "offered"]);
    assert.ok(LIVE_PHASES.has(COMMERCE_PHASE.HELD));
    assert.equal(LIVE_PHASES.has(COMMERCE_PHASE.CLOSED), false);
    for (const p of OPEN_PHASES) assert.ok(LIVE_PHASES.has(p));
    assert.ok(ALL_COMMERCE_PHASES.has(COMMERCE_PHASE.RETURNED));
  });

  it("Returned close → returned; other closes → closed", () => {
    assert.equal(phaseAfterClose(CLOSE_REASON.RETURNED), COMMERCE_PHASE.RETURNED);
    assert.equal(phaseAfterClose(CLOSE_REASON.SOLD), COMMERCE_PHASE.CLOSED);
    assert.equal(phaseAfterClose(CLOSE_REASON.HOLD_RELEASED), COMMERCE_PHASE.CLOSED);
    assert.equal(phaseAfterClose(CLOSE_REASON.REVERSAL_ABANDONED), COMMERCE_PHASE.CLOSED);
  });

  it("bidExtended compares successive endsAt", () => {
    assert.equal(bidExtended(null, 1000n), false);
    assert.equal(bidExtended(0n, 1000n), false);
    assert.equal(bidExtended(1000n, 1000n), false);
    assert.equal(bidExtended(1000n, 1050n), true);
  });
});

describe("ponder-commerce opened row vs chain snapshot", () => {
  it("maps ConsignmentOpened args into offered row with snapshotted fees", () => {
    const row = consignmentOpenedRow({
      chainId: 31337,
      mode: "fixedPrice",
      modeContract: MODE,
      saleOrdinal: 2,
      txHash: TX,
      logIndex: 3,
      timestamp: 1_700_000_000n,
      args: {
        tokenId: 42n,
        seller: SELLER,
        agent: AGENT,
        asset: zeroAddress,
        denominationKind: 0,
        currencyCode:
          "0x0000000000000000000000000000000000000000000000000000000000000000",
        floor: 10n,
        compensationForm: 1,
        commissionBps: 500,
        price: 100n,
        platformFeeBps: 250,
        openedAt: 1_700_000_000n,
      },
    });
    assert.equal(row.phase, COMMERCE_PHASE.OFFERED);
    assert.equal(row.saleOrdinal, 2);
    assert.equal(row.platformFeeBps, 250);
    assert.equal(row.commissionBps, 500);
    assert.equal(row.seller, getAddress(SELLER));
    assert.equal(row.agent, getAddress(AGENT));
    assert.equal(row.tokenId, "42");
    assert.equal(row.closeReason, null);
  });

  it("mandate grant does not receive floor/commission concession fields from consignment", () => {
    const m = mandateGrantedRow({
      chainId: 31337,
      mode: "ascending",
      modeContract: MODE,
      tokenId: 1n,
      owner: SELLER,
      agent: AGENT,
      expiry: 0n,
      asset: zeroAddress,
      denominationKind: 0,
      currencyCode:
        "0x0000000000000000000000000000000000000000000000000000000000000000",
      floor: 50n,
      compensationForm: 0,
      commissionBps: 0,
      timestamp: 10n,
    });
    assert.equal(m.active, true);
    assert.equal(m.floor, 50n);
    // Concessions patch consignment only — mandate row stays grant-time snapshot.
    assert.equal(m.commissionBps, 0);
  });
});

describe("ponder-commerce claim correlation", () => {
  it("matches account+amount to BidRefunded cause", () => {
    const bidder = SELLER;
    const causes = [
      causeFromBidRefunded({
        bidder,
        amount: 1_000n,
        asset: zeroAddress,
        logIndex: 5,
      }),
    ];
    const hit = correlateClaimReason({
      causes,
      claimAccount: bidder,
      claimAmount: 1_000n,
      claimLogIndex: 4,
    });
    // Claim logIndex < cause (pay-before-event) — still matches via backfill path
    // when claimLogIndex filter uses causes already collected after both indexed.
    // Unit: when claimLogIndex is higher than cause, match works:
    const hit2 = correlateClaimReason({
      causes,
      claimAccount: bidder,
      claimAmount: 1_000n,
      claimLogIndex: 6,
    });
    assert.equal(hit2.reasonCode, "ascending.outbid_refund");
    assert.equal(hit2.causeEvent, "BidRefunded");
    assert.equal(hit.reasonCode, "unknown");
  });

  it("matches split legs to owner/agent/platform", () => {
    const causes = causesFromSplitPaid({
      ownerRecipient: SELLER,
      ownerAmount: 900n,
      agentRecipient: AGENT,
      agentAmount: 50n,
      platformRecipient: MODE,
      platformAmount: 50n,
      asset: zeroAddress,
      logIndex: 8,
    });
    assert.equal(causes.length, 3);
    const owner = correlateClaimReason({
      causes,
      claimAccount: SELLER,
      claimAmount: 900n,
      claimLogIndex: 9,
    });
    assert.equal(owner.reasonCode, "consignment.owner_payout");
    const agent = correlateClaimReason({
      causes,
      claimAccount: AGENT,
      claimAmount: 50n,
      claimLogIndex: 9,
    });
    assert.equal(agent.reasonCode, "consignment.agent_payout");
    const platform = correlateClaimReason({
      causes,
      claimAccount: MODE,
      claimAmount: 50n,
      claimLogIndex: 9,
    });
    assert.equal(platform.reasonCode, "consignment.platform_payout");
  });

  it("required cause events omit unreachable ReversalAbandoned buyer refund", () => {
    assert.ok(REQUIRED_CLAIM_CAUSE_EVENTS.includes("ReversalCompleted"));
    assert.equal(
      (REQUIRED_CLAIM_CAUSE_EVENTS as readonly string[]).includes("ReversalAbandoned"),
      false,
    );
  });

  it("challenge bond terminal correlates", () => {
    const causes = [
      causeFromChallengeTerminal({
        eventName: "ChallengeJudged",
        bondRecipient: AGENT,
        bondAmount: 10_000_000_000_000_000n,
        logIndex: 2,
      }),
    ];
    const hit = correlateClaimReason({
      causes,
      claimAccount: AGENT,
      claimAmount: 10_000_000_000_000_000n,
      claimLogIndex: 3,
    });
    assert.equal(hit.reasonCode, "challenge.bond_routed");
  });

  it("unknown when no cause — hole signal", () => {
    const hit = correlateClaimReason({
      causes: [],
      claimAccount: SELLER,
      claimAmount: 1n,
      claimLogIndex: 0,
    });
    assert.equal(hit.reasonCode, "unknown");
    assert.equal(hit.causeEvent, "");
  });

  it("required production cause event names are listed", () => {
    assert.ok(REQUIRED_CLAIM_CAUSE_EVENTS.includes("BidRefunded"));
    assert.ok(REQUIRED_CLAIM_CAUSE_EVENTS.includes("ConsignmentSplitPaid"));
    assert.ok(REQUIRED_CLAIM_CAUSE_EVENTS.includes("ChallengeJudged"));
  });

  it("commerce claim balance accumulates then clears on withdraw", () => {
    const credit = commerceClaimCreditRow({
      chainId: 31337,
      contract: MODE,
      account: SELLER,
      asset: zeroAddress,
      amount: 100n,
      reasonCode: "ascending.outbid_refund",
      causeEvent: "BidRefunded",
      txHash: TX,
      logIndex: 1,
      timestamp: 50n,
    });
    const after = commerceClaimAfterCredit({ existing: null, credit });
    assert.equal(after.amount, 100n);
    const after2 = commerceClaimAfterCredit({
      existing: after,
      credit: { ...credit, amount: 25n, id: "x-2", timestamp: 60n },
    });
    assert.equal(after2.amount, 125n);
    const withdrawn = commerceClaimAfterWithdraw({
      existing: after2,
      timestamp: 70n,
    });
    assert.equal(withdrawn.amount, 0n);
  });
});

describe("ponder-commerce challenge opened", () => {
  it("opens with open status", () => {
    const row = challengeOpenedRow({
      chainId: 31337,
      instance: "ascending",
      instanceContract: MODE,
      subjectId: 7n,
      challenger: AGENT,
      bondAmount: 1n,
      windowDuration: 100n,
      openedAt: 10n,
      txHash: TX,
      logIndex: 0,
      timestamp: 10n,
    });
    assert.equal(row.status, "open");
    assert.equal(row.instance, "ascending");
    assert.equal(row.subjectId, "7");
  });
});

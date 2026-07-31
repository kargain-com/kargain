/**
 * Obligation facts mapping + obligations route registration.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { zeroAddress } from "viem";

import {
  buildObligationFacts,
  mapBidFact,
  mapChallengeFact,
  mapConsignmentFact,
  mapHoldFact,
  mergeConsignmentsById,
} from "../src/lib/ponder-obligations.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ROUTES = path.join(ROOT, "src/api/commerce-routes.ts");
const SCHEMA = path.join(ROOT, "ponder.schema.ts");
const NOTIF = path.join(ROOT, "src/api/notifications-query.ts");

describe("commerce obligations HTTP + schema indexes", () => {
  it("registers GET /accounts/:address/obligations", () => {
    const src = readFileSync(ROUTES, "utf8");
    assert.ok(src.includes('"/accounts/:address/obligations"'));
    assert.ok(src.includes("loadObligationFacts"));
  });

  it("schema adds party indexes for buyer / bidder / challenger / hold", () => {
    const src = readFileSync(SCHEMA, "utf8");
    assert.match(src, /buyerIdx:\s*index\(\)\.on\(table\.buyer\)/);
    assert.match(src, /bidderIdx:\s*index\(\)\.on\(table\.bidder\)/);
    assert.match(src, /challengerIdx:\s*index\(\)\.on\(table\.challenger\)/);
    assert.match(src, /stateIdx:\s*index\(\)\.on\(table\.state\)/);
  });

  it("notifications feed stamps commerce kinds and approaching via derivation", () => {
    const src = readFileSync(NOTIF, "utf8");
    for (const needle of [
      "commerce.bid_refunded",
      "commerce.settled",
      "commerce.challenge_opened",
      "commerce.reversal_started",
      "commerceClaimCredit",
      "deriveOutstandingObligations",
      "isApproachingDeadline",
      "approachingNotificationId",
      "approachingNotificationKind",
    ]) {
      assert.ok(src.includes(needle), `missing ${needle} in notifications-query`);
    }
  });
});

describe("ponder-obligations mappers", () => {
  it("maps consignment recall and hold abandonment seconds", () => {
    const consignment = mapConsignmentFact({
      id: "84532-ascending-1",
      chainId: 84532,
      mode: "ascending",
      modeContract: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      tokenId: "1",
      seller: "0x1111111111111111111111111111111111111111",
      agent: zeroAddress,
      buyer: "0x2222222222222222222222222222222222222222",
      phase: "held",
      recallRequestedAt: 1_700_000_000n,
    });
    assert.equal(consignment.recallRequestedAt, 1_700_000_000);
    assert.equal(consignment.mode, "ascending");

    const hold = mapHoldFact({
      id: "h1",
      consignmentId: "84532-ascending-1",
      chainId: 84532,
      tokenId: "1",
      buyer: "0x2222222222222222222222222222222222222222",
      gross: 1n,
      protectionEndsAt: 1_700_100_000n,
      state: "reversalStarted",
      abandonmentDeadline: 1_700_200_000n,
    });
    assert.equal(hold.protectionEndsAt, 1_700_100_000);
    assert.equal(hold.abandonmentDeadline, 1_700_200_000);
  });

  it("drops malformed challenge instance/status; merges consignments by id", () => {
    assert.equal(
      mapChallengeFact({
        id: "bad",
        chainId: 84532,
        instance: "other",
        instanceContract: zeroAddress,
        subjectId: "1",
        challenger: zeroAddress,
        bondAmount: 0n,
        windowDuration: 0n,
        openedAt: 0n,
        status: "open",
      }),
      null,
    );

    const bid = mapBidFact({
      id: "b1",
      consignmentId: "c1",
      chainId: 84532,
      tokenId: "1",
      bidder: "0x3333333333333333333333333333333333333333",
      amount: 5n,
      endsAt: 99n,
      refunded: false,
      timestamp: 10n,
    });
    assert.equal(bid.amount, "5");
    assert.equal(bid.endsAt, 99);

    const merged = mergeConsignmentsById([
      {
        id: "c1",
        chainId: 84532,
        mode: "ascending",
        modeContract: zeroAddress,
        tokenId: "1",
        seller: zeroAddress,
        agent: zeroAddress,
        buyer: "",
        phase: "offered",
        recallRequestedAt: null,
      },
      {
        id: "c1",
        chainId: 84532,
        mode: "ascending",
        modeContract: zeroAddress,
        tokenId: "1",
        seller: zeroAddress,
        agent: zeroAddress,
        buyer: "",
        phase: "binding",
        recallRequestedAt: null,
      },
    ]);
    assert.equal(merged.length, 1);
    assert.equal(merged[0]!.phase, "binding");

    const facts = buildObligationFacts({
      unresolved: false,
      consignments: merged,
      holds: [],
      bids: [],
      challenges: [
        {
          id: "ok",
          chainId: 84532,
          instance: "passport",
          instanceContract: zeroAddress,
          subjectId: "9",
          challenger: "0x4444444444444444444444444444444444444444",
          bondAmount: 1n,
          windowDuration: 100n,
          openedAt: 50n,
          status: "open",
        },
      ],
      passports: [],
      modes: [],
    });
    assert.equal(facts.challenges.length, 1);
    assert.equal(facts.challenges[0]!.windowDuration, 100);
  });
});

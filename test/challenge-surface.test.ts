/**
 * Bonded-challenge surface — one derivation for verification + settlement.
 *
 * Named scenarios reproduce defects the dual-module layout used to allow:
 * - qualification_missing
 * - unreadable_window_fail_open
 * - judge_after_window
 * - rejection_closes_sale
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  SETTLEMENT_INSTANCE,
  SETTLEMENT_TERMINALS,
  VERIFICATION_INSTANCE,
  VERIFICATION_TERMINALS,
  challengeElapsedFeedCopy,
  challengeTerminalTimelineLabel,
  challengeTrustCopyKind,
  deriveChallengePhase,
  deriveChallengeSurface,
  isAvailable,
  parseChallenge,
  parseChallengeTerminal,
  settlementWithdrawDisclosure,
  type ChallengeSnapshot,
} from "@/lib/challenge";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PASSPORT_ACTIONS = path.join(
  ROOT,
  "components/passport/passport-actions-panel.tsx",
);
const SETTLEMENT_PANEL = path.join(
  ROOT,
  "components/auction/auction-settlement-panel.tsx",
);
const OWNER = "0x1111111111111111111111111111111111111111";
const VERIFIER = "0x2222222222222222222222222222222222222222";
const OPENER = "0x3333333333333333333333333333333333333333";
const INDEPENDENT = "0x4444444444444444444444444444444444444444";
const BUYER = "0x5555555555555555555555555555555555555555";
const SELLER = "0x6666666666666666666666666666666666666666";
const AGENT = "0x7777777777777777777777777777777777777777";
const OPENED = 1_700_000_000;
const WINDOW = 14 * 24 * 60 * 60;

function settlementChallenge(
  overrides: Partial<ChallengeSnapshot> = {},
): ChallengeSnapshot {
  return {
    subjectId: "1",
    challenger: BUYER as `0x${string}`,
    bondAmount: 10_000_000_000_000_000n,
    windowDuration: WINDOW,
    openedAt: OPENED,
    ...overrides,
  };
}

describe("deriveChallengePhase — fail closed", () => {
  it("unreadable_window_fail_open: duration ≤ 0 / null is unresolved, never active", () => {
    // Previous commerce/challenge.challengeWindowPhase treated duration ≤ 0 as active.
    const zero = deriveChallengePhase({
      openedAt: OPENED,
      windowDuration: 0,
      nowSec: OPENED + 60,
    });
    assert.equal(zero.unresolved, true);
    assert.notEqual(zero.phase, "active");

    const missing = deriveChallengePhase({
      openedAt: OPENED,
      windowDuration: null,
      nowSec: OPENED + 60,
    });
    assert.equal(missing.unresolved, true);
    assert.notEqual(missing.phase, "active");
  });

  it("active while now < endsAt; elapsed at equality", () => {
    const active = deriveChallengePhase({
      openedAt: OPENED,
      windowDuration: WINDOW,
      nowSec: OPENED + WINDOW - 1,
    });
    assert.equal(active.unresolved, false);
    assert.equal(active.phase, "active");
    assert.equal(active.windowRemainingSec, 1);

    const elapsed = deriveChallengePhase({
      openedAt: OPENED,
      windowDuration: WINDOW,
      nowSec: OPENED + WINDOW,
    });
    assert.equal(elapsed.unresolved, false);
    assert.equal(elapsed.phase, "elapsed");
  });
});

describe("qualification_missing", () => {
  it("settlement does not offer judge without active KarPro (distinct from party)", () => {
    // Previous deriveChallengeActions offered judge to any non-party.
    const stranger = "0x8888888888888888888888888888888888888888";
    const notQualified = deriveChallengeSurface(SETTLEMENT_INSTANCE, {
      challenge: settlementChallenge(),
      wallet: stranger,
      isActiveVerifier: false,
      buyer: BUYER,
      seller: SELLER,
      agent: AGENT,
      subjectChallengeable: false,
      nowSec: OPENED + 60,
    });
    assert.equal(isAvailable(notQualified.judge), false);
    assert.equal(
      notQualified.judge.status === "blocked" && notQualified.judge.cause,
      "not_qualified",
    );

    const party = deriveChallengeSurface(SETTLEMENT_INSTANCE, {
      challenge: settlementChallenge(),
      wallet: SELLER,
      isActiveVerifier: true,
      buyer: BUYER,
      seller: SELLER,
      agent: AGENT,
      nowSec: OPENED + 60,
    });
    assert.equal(isAvailable(party.judge), false);
    assert.equal(
      party.judge.status === "blocked" && party.judge.cause,
      "party_excluded",
    );

    const ok = deriveChallengeSurface(SETTLEMENT_INSTANCE, {
      challenge: settlementChallenge(),
      wallet: stranger,
      isActiveVerifier: true,
      buyer: BUYER,
      seller: SELLER,
      agent: AGENT,
      nowSec: OPENED + 60,
    });
    assert.equal(isAvailable(ok.judge), true);
  });

  it("unresolved verifier status blocks judge as reads_unresolved, not not_qualified", () => {
    const s = deriveChallengeSurface(SETTLEMENT_INSTANCE, {
      challenge: settlementChallenge(),
      wallet: INDEPENDENT,
      isActiveVerifier: undefined,
      buyer: BUYER,
      seller: SELLER,
      agent: AGENT,
      nowSec: OPENED + 60,
    });
    assert.equal(isAvailable(s.judge), false);
    assert.equal(
      s.judge.status === "blocked" && s.judge.cause,
      "reads_unresolved",
    );
  });
});

describe("judge_after_window", () => {
  it("after the window, judge is absent; conclude is available", () => {
    // Previous feed row said "conclude or judge"; passport panel correctly withheld judge.
    const s = deriveChallengeSurface(SETTLEMENT_INSTANCE, {
      challenge: settlementChallenge(),
      wallet: INDEPENDENT,
      isActiveVerifier: true,
      buyer: BUYER,
      seller: SELLER,
      agent: AGENT,
      nowSec: OPENED + WINDOW + 1,
    });
    assert.equal(s.phase, "elapsed");
    assert.equal(isAvailable(s.judge), false);
    assert.equal(
      s.judge.status === "blocked" && s.judge.cause,
      "window_elapsed",
    );
    assert.equal(isAvailable(s.conclude), true);
    assert.match(challengeElapsedFeedCopy("settlement"), /conclude/i);
    assert.doesNotMatch(challengeElapsedFeedCopy("settlement"), /or judge/i);
  });
});

describe("rejection_closes_sale", () => {
  it("settlement reject consequence pays the seller — does not resume protection", () => {
    // Previous settlement panel: "Rejecting the challenge resumes the protection clock…"
    const copy = SETTLEMENT_TERMINALS.rejected.judgeCopy;
    assert.match(copy, /pays the seller/i);
    assert.match(copy, /closes the sale/i);
    assert.doesNotMatch(copy, /resumes the protection/i);
    assert.doesNotMatch(copy, /protection clock/i);
  });

  it("settlement uphold separates bond return (judge tx) from settled amount (completion)", () => {
    const copy = SETTLEMENT_TERMINALS.upheld.judgeCopy;
    assert.match(copy, /bond returns/i);
    assert.match(copy, /this transaction/i);
    assert.match(copy, /settled amount/i);
    assert.match(copy, /returning the passport/i);
  });

  it("settlement expire / conclude pays the seller", () => {
    assert.match(SETTLEMENT_TERMINALS.expired.concludeCopy, /seller is paid/i);
    assert.match(SETTLEMENT_TERMINALS.expired.concludeCopy, /sale closes/i);
  });
});

describe("verification instance", () => {
  it("offers open only while VERIFIED and connected", () => {
    const open = deriveChallengeSurface(VERIFICATION_INSTANCE, {
      challenge: null,
      wallet: OWNER,
      isActiveVerifier: false,
      passportStatus: "VERIFIED",
      owner: OWNER,
      recordedVerifier: "",
      opener: "",
      nowSec: OPENED,
      requireDisputedStatus: true,
    });
    assert.equal(isAvailable(open.open), true);

    const guest = deriveChallengeSurface(VERIFICATION_INSTANCE, {
      challenge: null,
      wallet: null,
      isActiveVerifier: false,
      passportStatus: "VERIFIED",
      owner: OWNER,
      recordedVerifier: "",
      opener: "",
      nowSec: OPENED,
      requireDisputedStatus: true,
    });
    assert.equal(isAvailable(guest.open), false);
  });

  it("excludes opener, owner, recorded verifier from judging", () => {
    const challenge: ChallengeSnapshot = {
      subjectId: "1",
      challenger: OPENER as `0x${string}`,
      bondAmount: 1n,
      windowDuration: WINDOW,
      openedAt: OPENED,
    };
    for (const [wallet, party] of [
      [OPENER, "opener"],
      [OWNER, "owner"],
      [VERIFIER, "recorded_verifier"],
    ] as const) {
      const s = deriveChallengeSurface(VERIFICATION_INSTANCE, {
        challenge,
        wallet,
        isActiveVerifier: true,
        passportStatus: "DISPUTED",
        owner: OWNER,
        recordedVerifier: VERIFIER,
        opener: OPENER,
        nowSec: OPENED + 60,
        requireDisputedStatus: true,
      });
      assert.equal(isAvailable(s.judge), false, wallet);
      assert.equal(s.exclusionParty, party, wallet);
    }
  });

  it("offers withdraw only to opener while active; conclude after elapsed", () => {
    const challenge: ChallengeSnapshot = {
      subjectId: "1",
      challenger: OPENER as `0x${string}`,
      bondAmount: 1n,
      windowDuration: WINDOW,
      openedAt: OPENED,
    };
    const mid = deriveChallengeSurface(VERIFICATION_INSTANCE, {
      challenge,
      wallet: OPENER,
      isActiveVerifier: false,
      passportStatus: "DISPUTED",
      owner: OWNER,
      recordedVerifier: VERIFIER,
      opener: OPENER,
      nowSec: OPENED + 60,
      requireDisputedStatus: true,
    });
    assert.equal(isAvailable(mid.withdraw), true);
    assert.equal(isAvailable(mid.conclude), false);

    const after = deriveChallengeSurface(VERIFICATION_INSTANCE, {
      challenge,
      wallet: INDEPENDENT,
      isActiveVerifier: true,
      passportStatus: "DISPUTED",
      owner: OWNER,
      recordedVerifier: VERIFIER,
      opener: OPENER,
      nowSec: OPENED + WINDOW + 1,
      requireDisputedStatus: true,
    });
    assert.equal(isAvailable(after.judge), false);
    assert.equal(isAvailable(after.conclude), true);
  });
});

describe("parseChallengeTerminal wire", () => {
  it("maps legacy ponder tags onto canonical names", () => {
    assert.equal(parseChallengeTerminal("confirm"), "upheld");
    assert.equal(parseChallengeTerminal("expire"), "expired");
    assert.equal(parseChallengeTerminal("reject"), "rejected");
    assert.equal(parseChallengeTerminal("withdraw"), "withdrawn");
    assert.equal(parseChallengeTerminal("upheld"), "upheld");
    assert.equal(parseChallengeTerminal("bogus"), "");
  });
});

describe("challengeTrustCopyKind", () => {
  it("classifies expired as lapsed and upheld from legacy confirm", () => {
    assert.equal(
      challengeTrustCopyKind({
        status: "UNVERIFIED",
        hadDispute: true,
        lastDisputeTerminal: "expire",
      }),
      "lapsed",
    );
    assert.equal(
      challengeTrustCopyKind({
        status: "UNVERIFIED",
        hadDispute: true,
        lastDisputeTerminal: "confirm",
      }),
      "upheld",
    );
    assert.equal(challengeTerminalTimelineLabel("expired"), "Verification lapsed");
    assert.equal(challengeTerminalTimelineLabel("upheld"), "Challenge upheld");
  });
});

describe("parseChallenge snapshot", () => {
  it("sets windowDuration null when chain window is zero (fail closed)", () => {
    const snap = parseChallenge("1", {
      challenger: BUYER,
      openedAt: OPENED,
      windowDuration: 0,
      bondAmount: 1n,
    });
    assert.ok(snap);
    assert.equal(snap.windowDuration, null);
  });
});

describe("verification vs settlement terminal definitions differ", () => {
  it("same terminal id, instance-specific consequence", () => {
    assert.match(VERIFICATION_TERMINALS.rejected.judgeCopy, /verification stands/i);
    assert.match(SETTLEMENT_TERMINALS.rejected.judgeCopy, /pays the seller/i);
    assert.match(VERIFICATION_TERMINALS.expired.concludeCopy, /verification lapses/i);
    assert.match(SETTLEMENT_TERMINALS.expired.concludeCopy, /seller is paid/i);
  });
});

describe("verification_withdraw_permanence", () => {
  it("withdrawCopy and description name permanent attributed public record", () => {
    const { withdrawCopy, description } = VERIFICATION_TERMINALS.withdrawn;
    assert.match(withdrawCopy, /permanently/i);
    assert.match(withdrawCopy, /public timeline/i);
    assert.match(withdrawCopy, /attributed to you/i);
    assert.match(withdrawCopy, /restores VERIFIED/i);
    assert.match(withdrawCopy, /returns your deposit/i);
    assert.match(description, /public record/i);
    assert.match(description, /attributed to the opener/i);
  });

  it("passport-actions panel consumes withdrawCopy — no inline permanence sentence", () => {
    const panel = fs.readFileSync(PASSPORT_ACTIONS, "utf8");
    assert.match(
      panel,
      /terminals\.withdrawn\.withdrawCopy/,
      "passport-actions-panel must render withdrawn.withdrawCopy",
    );
    assert.doesNotMatch(
      panel,
      /This restores VERIFIED status and returns your/,
      "inline withdraw help must not remain beside the terminal definition",
    );
  });
});

describe("settlement_withdraw_frozen_remainder", () => {
  it("names formatted remainder when frozen remaining is readable", () => {
    const day = settlementWithdrawDisclosure(7 * 24 * 60 * 60);
    assert.match(day, /7 days remaining/i);
    assert.match(day, /returns your bond/i);
    assert.match(day, /resumes the protection window/i);

    const hours = settlementWithdrawDisclosure(3 * 60 * 60);
    assert.match(hours, /3 hours remaining/i);
  });

  it("falls back to qualitative terminal description when remainder unread", () => {
    assert.equal(
      settlementWithdrawDisclosure(null),
      SETTLEMENT_TERMINALS.withdrawn.description,
    );
    assert.equal(
      settlementWithdrawDisclosure(undefined),
      SETTLEMENT_TERMINALS.withdrawn.description,
    );
    assert.equal(
      settlementWithdrawDisclosure(0),
      SETTLEMENT_TERMINALS.withdrawn.description,
    );
    assert.match(
      SETTLEMENT_TERMINALS.withdrawn.description,
      /resumes from where it stood/i,
    );
  });

  it("settlement panel renders disclosure beside withdraw", () => {
    const panel = fs.readFileSync(SETTLEMENT_PANEL, "utf8");
    assert.match(
      panel,
      /settlementWithdrawDisclosure\(hold\?\.frozenRemaining\)/,
      "auction-settlement-panel must pass hold.frozenRemaining to settlementWithdrawDisclosure",
    );
    assert.match(
      panel,
      /challengeSurface\.openDisclosure/,
      "open help must consume challengeSurface.openDisclosure",
    );
  });
});

describe("verification challenge window — chain only (S19)", () => {
  it("does not export a mirrored verification window constant", async () => {
    const challenge = await import("@/lib/challenge");
    assert.equal(
      "VERIFICATION_CHALLENGE_WINDOW_SECONDS" in challenge,
      false,
      "app must not shadow KarPassport.DISPUTE_WINDOW with a TS seconds constant",
    );
    assert.equal(
      "SETTLEMENT_CHALLENGE_WINDOW_DEPLOY_SECONDS" in challenge,
      false,
      "S30: pre-open settlement window is Ascending windowDuration(), not a TS constant",
    );
  });

  it("Actions reads DISPUTE_WINDOW from chain", () => {
    const panel = fs.readFileSync(PASSPORT_ACTIONS, "utf8");
    assert.match(
      panel,
      /functionName:\s*"DISPUTE_WINDOW"/,
      "passport-actions-panel must read KarPassport.DISPUTE_WINDOW",
    );
    assert.doesNotMatch(
      panel,
      /VERIFICATION_CHALLENGE_WINDOW_SECONDS/,
      "panel must not import a mirrored window constant",
    );
  });

  it("auction chain reads bind Ascending windowDuration config getter", () => {
    const reads = fs.readFileSync(
      path.join(process.cwd(), "hooks/use-auction-chain-reads.ts"),
      "utf8",
    );
    assert.match(
      reads,
      /functionName:\s*"windowDuration"/,
      "ascending settlement must read BondedChallenge windowDuration()",
    );
    assert.doesNotMatch(
      reads,
      /SETTLEMENT_CHALLENGE_WINDOW_DEPLOY_SECONDS/,
    );
  });
});

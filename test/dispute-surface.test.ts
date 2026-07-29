import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  deriveDisputeSurface,
  disputeExclusionCopy,
  parseDisputeTerminal,
  PASSPORT_DISPUTE_WINDOW_SECONDS,
  type DisputeSurfaceInput,
} from "../lib/passport/dispute-surface.ts";

const OWNER = "0x1111111111111111111111111111111111111111";
const VERIFIER = "0x2222222222222222222222222222222222222222";
const OPENER = "0x3333333333333333333333333333333333333333";
const INDEPENDENT = "0x4444444444444444444444444444444444444444";
const OPENED = 1_700_000_000;
const WINDOW = PASSPORT_DISPUTE_WINDOW_SECONDS;

function disputed(
  overrides: Partial<DisputeSurfaceInput> = {},
): DisputeSurfaceInput {
  return {
    status: "DISPUTED",
    disputeOpenedAt: OPENED,
    disputeWindowSec: WINDOW,
    nowSec: OPENED + 60,
    wallet: INDEPENDENT,
    isActiveVerifier: true,
    owner: OWNER,
    recordedVerifier: VERIFIER,
    opener: OPENER,
    ...overrides,
  };
}

describe("deriveDisputeSurface", () => {
  it("offers open dispute only while VERIFIED and connected", () => {
    const open = deriveDisputeSurface({
      status: "VERIFIED",
      disputeOpenedAt: 0,
      disputeWindowSec: WINDOW,
      nowSec: OPENED,
      wallet: OWNER,
      isActiveVerifier: false,
      owner: OWNER,
      recordedVerifier: "",
      opener: "",
    });
    assert.equal(open.canOpen, true);
    assert.equal(open.canWithdraw, false);
    assert.equal(open.canResolve, false);
    assert.equal(open.canExpire, false);
    assert.equal(open.windowPhase, "none");

    const guest = deriveDisputeSurface({
      status: "VERIFIED",
      disputeOpenedAt: 0,
      disputeWindowSec: WINDOW,
      nowSec: OPENED,
      wallet: null,
      isActiveVerifier: false,
      owner: OWNER,
      recordedVerifier: "",
      opener: "",
    });
    assert.equal(guest.canOpen, false);
  });

  it("does not offer resolve to opener, owner, or recorded verifier", () => {
    for (const [wallet, reason] of [
      [OPENER, "opener"],
      [OWNER, "owner"],
      [VERIFIER, "recorded_verifier"],
    ] as const) {
      const s = deriveDisputeSurface(
        disputed({ wallet, isActiveVerifier: true }),
      );
      assert.equal(s.canResolve, false, wallet);
      assert.equal(s.exclusionReason, reason, wallet);
      assert.ok(disputeExclusionCopy(reason));
    }
  });

  it("offers resolve only to an independent active verifier", () => {
    const s = deriveDisputeSurface(disputed());
    assert.equal(s.canResolve, true);
    assert.equal(s.exclusionReason, null);
    assert.equal(s.canWithdraw, false);
    assert.equal(s.canExpire, false);
    assert.equal(s.windowPhase, "active");
  });

  it("fails closed on unresolved verifier status", () => {
    const s = deriveDisputeSurface(
      disputed({ isActiveVerifier: undefined }),
    );
    assert.equal(s.canResolve, false);
    assert.equal(s.exclusionReason, "not_verifier");
  });

  it("offers withdraw only to opener during the active window", () => {
    const mid = deriveDisputeSurface(
      disputed({ wallet: OPENER, isActiveVerifier: false }),
    );
    assert.equal(mid.canWithdraw, true);
    assert.equal(mid.canResolve, false);
    assert.equal(mid.canExpire, false);
    assert.equal(mid.windowPhase, "active");
    assert.equal(mid.windowEndsAt, OPENED + WINDOW);
    assert.equal(mid.windowRemainingSec, WINDOW - 60);

    const after = deriveDisputeSurface(
      disputed({
        wallet: OPENER,
        nowSec: OPENED + WINDOW,
        isActiveVerifier: false,
      }),
    );
    assert.equal(after.canWithdraw, false);
    assert.equal(after.windowPhase, "elapsed");
    assert.equal(after.canExpire, true);
  });

  it("window boundary: active while now < endsAt; elapsed at equality", () => {
    const lastActive = deriveDisputeSurface(
      disputed({ nowSec: OPENED + WINDOW - 1 }),
    );
    assert.equal(lastActive.windowPhase, "active");
    assert.equal(lastActive.canExpire, false);
    assert.equal(lastActive.windowRemainingSec, 1);

    const elapsed = deriveDisputeSurface(
      disputed({ nowSec: OPENED + WINDOW }),
    );
    assert.equal(elapsed.windowPhase, "elapsed");
    assert.equal(elapsed.canExpire, true);
    assert.equal(elapsed.windowRemainingSec, 0);
  });

  it("offers expire to anyone connected after the window; never resolve", () => {
    const guest = deriveDisputeSurface(
      disputed({
        wallet: "0x5555555555555555555555555555555555555555",
        isActiveVerifier: false,
        nowSec: OPENED + WINDOW + 1,
      }),
    );
    assert.equal(guest.canExpire, true);
    assert.equal(guest.canWithdraw, false);
    assert.equal(guest.canResolve, false);

    const independent = deriveDisputeSurface(
      disputed({ nowSec: OPENED + WINDOW + 1 }),
    );
    assert.equal(independent.canExpire, true);
    assert.equal(independent.canResolve, false);
    assert.equal(independent.canWithdraw, false);
  });

  it("offers resolve only while the window is active", () => {
    const active = deriveDisputeSurface(
      disputed({ nowSec: OPENED + WINDOW - 1 }),
    );
    assert.equal(active.windowPhase, "active");
    assert.equal(active.canResolve, true);
    assert.equal(active.canExpire, false);

    const elapsed = deriveDisputeSurface(
      disputed({ nowSec: OPENED + WINDOW }),
    );
    assert.equal(elapsed.windowPhase, "elapsed");
    assert.equal(elapsed.canResolve, false);
    assert.equal(elapsed.canExpire, true);
  });

  it("does not offer expire without a recorded opening", () => {
    const s = deriveDisputeSurface(
      disputed({ disputeOpenedAt: 0, nowSec: OPENED + WINDOW * 2 }),
    );
    assert.equal(s.windowPhase, "none");
    assert.equal(s.canExpire, false);
  });

  it("hides all dispute writes while UNVERIFIED", () => {
    const s = deriveDisputeSurface({
      status: "UNVERIFIED",
      disputeOpenedAt: OPENED,
      disputeWindowSec: WINDOW,
      nowSec: OPENED + WINDOW + 1,
      wallet: INDEPENDENT,
      isActiveVerifier: true,
      owner: OWNER,
      recordedVerifier: VERIFIER,
      opener: OPENER,
    });
    assert.equal(s.canOpen, false);
    assert.equal(s.canWithdraw, false);
    assert.equal(s.canResolve, false);
    assert.equal(s.canExpire, false);
  });
});

describe("parseDisputeTerminal", () => {
  it("accepts known terminals and rejects unknown", () => {
    assert.equal(parseDisputeTerminal("expire"), "expire");
    assert.equal(parseDisputeTerminal("confirm"), "confirm");
    assert.equal(parseDisputeTerminal("bogus"), "");
    assert.equal(parseDisputeTerminal(undefined), "");
  });
});

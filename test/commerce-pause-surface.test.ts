import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  COMMERCE_PAUSED_ANNOUNCEMENT,
  commercePausedAnnouncementForMode,
  deriveGuardianPauseControl,
  formatPauseBlockedClause,
  pauseBlockedActions,
  pauseConfirmCopy,
  UNPAUSE_HINT,
} from "../lib/commerce/pause-surface.ts";

const GUARDIAN = "0x1111111111111111111111111111111111111111" as const;
const OWNER = "0x2222222222222222222222222222222222222222" as const;
const STRANGER = "0x3333333333333333333333333333333333333333" as const;

describe("deriveGuardianPauseControl", () => {
  it("offers pause only to the guardian while running", () => {
    const control = deriveGuardianPauseControl({
      connected: GUARDIAN,
      guardian: GUARDIAN,
      owner: OWNER,
      paused: false,
    });
    assert.deepEqual(control, {
      canPause: true,
      role: "guardian",
      showUnpauseHint: false,
    });
  });

  it("withholds pause from the owner even when running", () => {
    const control = deriveGuardianPauseControl({
      connected: OWNER,
      guardian: GUARDIAN,
      owner: OWNER,
      paused: false,
    });
    assert.equal(control.canPause, false);
    assert.equal(control.role, "owner");
  });

  it("withholds pause from strangers", () => {
    const control = deriveGuardianPauseControl({
      connected: STRANGER,
      guardian: GUARDIAN,
      owner: OWNER,
      paused: false,
    });
    assert.equal(control.canPause, false);
    assert.equal(control.role, "other");
  });

  it("withholds pause when already paused (guardian sees unpause hint)", () => {
    const control = deriveGuardianPauseControl({
      connected: GUARDIAN,
      guardian: GUARDIAN,
      owner: OWNER,
      paused: true,
    });
    assert.deepEqual(control, {
      canPause: false,
      role: "guardian",
      showUnpauseHint: true,
    });
  });

  it("treats disconnected wallets as no pause", () => {
    const control = deriveGuardianPauseControl({
      connected: null,
      guardian: GUARDIAN,
      owner: OWNER,
      paused: false,
    });
    assert.equal(control.canPause, false);
    assert.equal(control.role, "disconnected");
  });

  it("matches addresses case-insensitively", () => {
    const control = deriveGuardianPauseControl({
      connected: GUARDIAN.toLowerCase(),
      guardian: GUARDIAN,
      owner: OWNER,
      paused: false,
    });
    assert.equal(control.canPause, true);
    assert.equal(control.role, "guardian");
  });

  it("does not offer pause while paused state is unresolved", () => {
    const control = deriveGuardianPauseControl({
      connected: GUARDIAN,
      guardian: GUARDIAN,
      owner: OWNER,
      paused: undefined,
    });
    assert.equal(control.canPause, false);
  });
});

describe("pause confirmation and announcement copy", () => {
  it("lists fixed-price stop actions without bidding", () => {
    assert.deepEqual(pauseBlockedActions("fixedPrice"), [
      "opening new consignments",
      "buying",
    ]);
    assert.equal(
      formatPauseBlockedClause("fixedPrice"),
      "opening new consignments and buying",
    );
  });

  it("lists ascending stop actions without buying", () => {
    assert.deepEqual(pauseBlockedActions("ascending"), [
      "opening new consignments",
      "bidding",
    ]);
  });

  it("builds confirmation that states stop vs continue", () => {
    const copy = pauseConfirmCopy({
      mode: "ascending",
      chainLabel: "Base Sepolia",
    });
    assert.equal(copy.title, "Pause Ascending on Base Sepolia?");
    assert.match(copy.body, /opening new consignments and bidding/);
    assert.match(copy.body, /Settlement, claims, withdrawals, recall, and challenges keep running/);
    assert.match(copy.body, /only the timelock owner can unpause/);
    assert.doesNotMatch(copy.body, /buying/);
  });

  it("exports canonical announcement and mode variants", () => {
    assert.match(COMMERCE_PAUSED_ANNOUNCEMENT, /Opening, bidding, and buying/);
    assert.match(
      commercePausedAnnouncementForMode("fixedPrice"),
      /Opening and buying/,
    );
    assert.match(
      commercePausedAnnouncementForMode("ascending"),
      /Opening and bidding/,
    );
    assert.match(UNPAUSE_HINT, /timelock owner/);
  });
});

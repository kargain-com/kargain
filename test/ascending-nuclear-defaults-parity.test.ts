/**
 * Assert Nuclear Ascending deploy constants match the normative model
 * (docs/research/commerce-model-2026.md §11 / §7.3).
 *
 * Fails if scripts/lib/verify-constructor-args.ts drifts from the model
 * without updating these expected values (or vice versa).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseEther } from "viem";

import {
  ASCENDING_ABANDONMENT_WINDOW,
  ASCENDING_CHALLENGE_BOND,
  ASCENDING_CHALLENGE_WINDOW,
  ASCENDING_EXTENSION_WINDOW,
  ASCENDING_MAX_DURATION,
  ASCENDING_MIN_DURATION,
  ASCENDING_MIN_INCREMENT_BPS,
  ASCENDING_PROTECTION_WINDOW,
} from "../scripts/lib/verify-constructor-args.ts";

/** Normative model §11 / §7.3 — single expected set for Nuclear. */
const MODEL = {
  extensionWindowSec: 900n,
  minIncrementBps: 300n,
  minDurationSec: 3n * 24n * 60n * 60n,
  maxDurationSec: 30n * 24n * 60n * 60n,
  protectionWindowSec: 7n * 24n * 60n * 60n,
  challengeWindowSec: 30n * 24n * 60n * 60n,
  abandonmentWindowSec: 30n * 24n * 60n * 60n,
  challengeBondWei: parseEther("0.01"),
} as const;

describe("Ascending Nuclear defaults ↔ model §11 parity", () => {
  it("extension window is 900 seconds", () => {
    assert.equal(ASCENDING_EXTENSION_WINDOW, MODEL.extensionWindowSec);
  });

  it("minimum increment is 300 bps", () => {
    assert.equal(ASCENDING_MIN_INCREMENT_BPS, MODEL.minIncrementBps);
  });

  it("duration bounds are 3–30 days", () => {
    assert.equal(ASCENDING_MIN_DURATION, MODEL.minDurationSec);
    assert.equal(ASCENDING_MAX_DURATION, MODEL.maxDurationSec);
  });

  it("protection window is 7 days", () => {
    assert.equal(ASCENDING_PROTECTION_WINDOW, MODEL.protectionWindowSec);
  });

  it("settlement challenge window is 30 days (§7.3)", () => {
    assert.equal(ASCENDING_CHALLENGE_WINDOW, MODEL.challengeWindowSec);
  });

  it("abandonment window is 30 days", () => {
    assert.equal(ASCENDING_ABANDONMENT_WINDOW, MODEL.abandonmentWindowSec);
  });

  it("challenge bond is 0.01 ETH", () => {
    assert.equal(ASCENDING_CHALLENGE_BOND, MODEL.challengeBondWei);
  });
});

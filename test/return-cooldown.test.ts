import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  formatReturnCountdown,
  returnDeadline,
  returnRemainingSeconds,
  RETURN_COOLDOWN_SECONDS,
} from "../lib/marketplace/return-cooldown.ts";

describe("returnDeadline", () => {
  it("adds 7 days to request timestamp", () => {
    assert.equal(returnDeadline(1_000n), 1_000n + RETURN_COOLDOWN_SECONDS);
  });
});

describe("returnRemainingSeconds", () => {
  const requestedAt = 1_000_000n;

  it("returns positive remaining before deadline", () => {
    const now = requestedAt + 100n;
    const remaining = returnRemainingSeconds(requestedAt, now);
    assert.equal(remaining, RETURN_COOLDOWN_SECONDS - 100n);
  });

  it("returns zero after deadline", () => {
    const now = requestedAt + RETURN_COOLDOWN_SECONDS + 1n;
    assert.equal(returnRemainingSeconds(requestedAt, now), 0n);
  });

  it("returns zero exactly at deadline", () => {
    const now = requestedAt + RETURN_COOLDOWN_SECONDS;
    assert.equal(returnRemainingSeconds(requestedAt, now), 0n);
  });
});

describe("formatReturnCountdown", () => {
  it("shows days when more than one day remains", () => {
    assert.match(formatReturnCountdown(2n * 86_400n), /2 days/);
  });

  it("shows day and hours when one day plus hours remain", () => {
    const remaining = 86_400n + 3_600n;
    assert.match(formatReturnCountdown(remaining), /1 day/);
    assert.match(formatReturnCountdown(remaining), /1 hour/);
  });

  it("shows hours and minutes when under one day", () => {
    const remaining = 3_600n + 120n;
    assert.match(formatReturnCountdown(remaining), /1 hour/);
    assert.match(formatReturnCountdown(remaining), /2 minutes/);
  });

  it("shows minutes and seconds when under one hour", () => {
    const remaining = 125n;
    assert.match(formatReturnCountdown(remaining), /2 minutes/);
    assert.match(formatReturnCountdown(remaining), /5 seconds/);
  });

  it("shows zero seconds when elapsed", () => {
    assert.equal(formatReturnCountdown(0n), "0 seconds");
  });
});

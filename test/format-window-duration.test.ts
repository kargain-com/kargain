import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  durationBoundsErrorMessage,
  durationDayOptions,
  formatWindowDurationLabel,
  protectionBoundsErrorMessage,
} from "../lib/commerce/format-window-duration.ts";

describe("formatWindowDurationLabel", () => {
  it("returns null when unread or invalid", () => {
    assert.equal(formatWindowDurationLabel(null), null);
    assert.equal(formatWindowDurationLabel(undefined), null);
    assert.equal(formatWindowDurationLabel(0), null);
    assert.equal(formatWindowDurationLabel(-1), null);
  });

  it("formats whole days, hours, and minutes", () => {
    assert.equal(formatWindowDurationLabel(86_400), "1 day");
    assert.equal(formatWindowDurationLabel(7 * 86_400), "7 days");
    assert.equal(formatWindowDurationLabel(30 * 86_400), "30 days");
    assert.equal(formatWindowDurationLabel(900), "15 minutes");
    assert.equal(formatWindowDurationLabel(3_600), "1 hour");
  });

  it("accepts bigint", () => {
    assert.equal(formatWindowDurationLabel(900n), "15 minutes");
  });
});

describe("durationDayOptions", () => {
  it("lists whole days within Nuclear 3–30 day bounds", () => {
    const opts = durationDayOptions(3 * 86_400, 30 * 86_400);
    assert.equal(opts[0], 3);
    assert.equal(opts[opts.length - 1], 30);
    assert.equal(opts.length, 28);
  });
});

describe("durationBoundsErrorMessage", () => {
  it("names both bounds from seconds", () => {
    assert.equal(
      durationBoundsErrorMessage(3 * 86_400, 30 * 86_400),
      "Duration must be between 3 days and 30 days.",
    );
  });
});

describe("protectionBoundsErrorMessage", () => {
  it("names both bounds from seconds", () => {
    assert.equal(
      protectionBoundsErrorMessage(7 * 86_400, 45 * 86_400),
      "Protection must be between 7 days and 45 days.",
    );
  });
});

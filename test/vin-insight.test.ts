import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildVinInsight } from "../lib/passport/vin-insight.ts";

const NA_VALID_VIN = "1HGBH41JXMN109186";
const NA_INVALID_CHECK_DIGIT_VIN = "1HGBH41J0MN109186";
const EU_AMBIGUOUS_YEAR_VIN = "WBA3B1C50EK123456";
const EU_SINGLE_YEAR_VIN = "VF3RFAFHP13123456";
const LEGACY_13_VIN = "1234567890123";
const UNKNOWN_WMI_VIN = "ZZZZZZZZZZZZZZZZZ";

describe("buildVinInsight", () => {
  it("NA valid 17-char returns ok with year suggestion", () => {
    const insight = buildVinInsight(NA_VALID_VIN, "");
    assert.equal(insight.status, "ok");
    assert.equal(insight.yearSuggestion, 1991);
    assert.equal(insight.yearConflict, false);
    assert.equal(insight.messages.length, 0);
    assert.ok(insight.origin);
    assert.equal(insight.origin?.wmi, "1HG");
  });

  it("NA invalid check digit returns hard error", () => {
    const insight = buildVinInsight(NA_INVALID_CHECK_DIGIT_VIN, "");
    assert.equal(insight.status, "error");
    assert.ok(insight.messages.some((message) => message.includes("Check digit mismatch")));
  });

  it("EU VIN with ambiguous year returns advisory and no year suggestion", () => {
    const insight = buildVinInsight(EU_AMBIGUOUS_YEAR_VIN, "");
    assert.equal(insight.status, "warning");
    assert.ok(
      insight.messages.some((message) =>
        message.includes("common for European-market VINs"),
      ),
    );
    assert.equal(insight.yearSuggestion, null);
    assert.ok(insight.origin);
    assert.equal(insight.origin?.country, "GERMANY");
  });

  it("EU VIN with single candidate year returns year suggestion", () => {
    const insight = buildVinInsight(EU_SINGLE_YEAR_VIN, "");
    assert.equal(insight.yearSuggestion, 2001);
    assert.ok(insight.origin);
    assert.equal(insight.origin?.wmi, "VF3");
    assert.equal(insight.origin?.country, "FRANCE");
  });

  it("legacy 13-char includes legacy note without check-digit hard error", () => {
    const insight = buildVinInsight(LEGACY_13_VIN, "");
    assert.equal(insight.status, "incomplete");
    assert.ok(
      insight.messages.some((message) =>
        message.includes("Legacy VIN length"),
      ),
    );
    assert.equal(
      insight.messages.some((message) => message.includes("Check digit mismatch: expected")),
      false,
    );
  });

  it("year conflict when year field differs from suggestion", () => {
    const insight = buildVinInsight(NA_VALID_VIN, "2020");
    assert.equal(insight.yearSuggestion, 1991);
    assert.equal(insight.yearConflict, true);
  });

  it("unknown WMI returns null origin", () => {
    const insight = buildVinInsight(UNKNOWN_WMI_VIN, "");
    assert.equal(insight.origin, null);
  });

  it("empty status for VIN shorter than 11 characters", () => {
    const insight = buildVinInsight("1HG", "");
    assert.equal(insight.status, "empty");
    assert.equal(insight.origin, null);
  });
});

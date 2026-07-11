import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { normalizeVin } from "../lib/passport/metadata-schema.ts";
import { buildVinInsight, resolveVinOrigin } from "../lib/passport/vin-insight.ts";

const NA_VALID_VIN = "1HGBH41JXMN109186";
const NA_INVALID_CHECK_DIGIT_VIN = "1HGBH41J0MN109186";
const EU_AMBIGUOUS_YEAR_VIN = "WBA3B1C50EK123456";
const EU_SINGLE_YEAR_VIN = "VF3RFAFHP13123456";
const LEGACY_13_VIN = "1234567890123";
const UNKNOWN_WMI_VIN = "ZZZZZZZZZZZZZZZZZ";
// pos3=9 — extended WMI table (6-char key 1G9+positions 11–14)
const EXTENDED_WMI_VIN = "1G9EG26R0MR123456";

describe("buildVinInsight", () => {
  it("NA valid 17-char returns ok with year suggestion", () => {
    const insight = buildVinInsight(NA_VALID_VIN, "");
    assert.equal(insight.status, "ok");
    assert.equal(insight.yearSuggestion, 1991);
    assert.equal(insight.yearConflict, false);
    assert.equal(insight.messages.length, 0);
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
  });

  it("EU VIN with single candidate year returns year suggestion", () => {
    const insight = buildVinInsight(EU_SINGLE_YEAR_VIN, "");
    assert.equal(insight.yearSuggestion, 2001);
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

  it("empty status for VIN shorter than 11 characters", () => {
    const insight = buildVinInsight("1HG", "");
    assert.equal(insight.status, "empty");
  });
});

describe("resolveVinOrigin", () => {
  it("NA valid VIN returns Honda WMI", async () => {
    const origin = await resolveVinOrigin(normalizeVin(NA_VALID_VIN));
    assert.ok(origin);
    assert.equal(origin?.wmi, "1HG");
  });

  it("EU ambiguous year VIN returns Germany", async () => {
    const origin = await resolveVinOrigin(normalizeVin(EU_AMBIGUOUS_YEAR_VIN));
    assert.ok(origin);
    assert.equal(origin?.country, "GERMANY");
  });

  it("EU single year VIN returns France", async () => {
    const origin = await resolveVinOrigin(normalizeVin(EU_SINGLE_YEAR_VIN));
    assert.ok(origin);
    assert.equal(origin?.wmi, "VF3");
    assert.equal(origin?.country, "FRANCE");
  });

  it("unknown WMI returns null", async () => {
    const origin = await resolveVinOrigin(normalizeVin(UNKNOWN_WMI_VIN));
    assert.equal(origin, null);
  });

  it("input shorter than 3 chars returns null", async () => {
    const origin = await resolveVinOrigin("1H");
    assert.equal(origin, null);
  });

  it("pos3=9 VIN resolves via extended WMI table", async () => {
    const origin = await resolveVinOrigin(normalizeVin(EXTENDED_WMI_VIN));
    assert.ok(origin);
    assert.equal(origin?.wmi, "1G9123");
    assert.equal(origin?.manufacturer, "GENERAL BODY MANUFACTURING COMPANY");
    assert.equal(origin?.country, "UNITED STATES (USA)");
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DISPUTE_WITHDRAWN_PREFIX } from "../lib/passport/index-passport-metadata.ts";
import {
  getDisputeBannerText,
  getRecordDisplay,
  isOpeningDisputeRecord,
} from "../lib/passport/record-types.ts";
import type { PonderPassportRecord } from "../lib/types/ponder.ts";

const owner = "0xOwner000000000000000000000000000000000001";
const disputer = "0xDisputer000000000000000000000000000000001";
const thirdParty = "0xOther00000000000000000000000000000000001";

function record(
  partial: Partial<PonderPassportRecord> & Pick<PonderPassportRecord, "recordType">,
): PonderPassportRecord {
  return {
    id: "1",
    tokenId: "0",
    author: owner,
    description: "",
    evidenceCID: "",
    timestamp: "1000",
    ...partial,
  };
}

const ctx = {
  passportOwner: owner,
  lastDisputer: disputer,
  disputeReason: "Odometer mismatch",
};

describe("isOpeningDisputeRecord", () => {
  it("matches the on-chain dispute record by author and reason", () => {
    assert.equal(
      isOpeningDisputeRecord(
        record({
          recordType: "discrepancy",
          author: disputer,
          description: "Odometer mismatch",
        }),
        ctx,
      ),
      true,
    );
  });

  it("rejects lightweight discrepancy reports from third parties", () => {
    assert.equal(
      isOpeningDisputeRecord(
        record({
          recordType: "discrepancy",
          author: thirdParty,
          description: "Paint color looks wrong",
        }),
        ctx,
      ),
      false,
    );
  });
});

describe("getRecordDisplay", () => {
  it("labels service and attestation records", () => {
    const service = getRecordDisplay(record({ recordType: "service" }), ctx);
    assert.equal(service.label, "Service history");
    assert.equal(service.severity, "neutral");

    const attestation = getRecordDisplay(record({ recordType: "attestation" }), ctx);
    assert.equal(attestation.label, "Verifier attestation");
    assert.equal(attestation.severity, "success");
  });

  it("marks owner-initiated dispute opening", () => {
    const display = getRecordDisplay(
      record({
        recordType: "discrepancy",
        author: owner,
        description: "Odometer mismatch",
      }),
      { ...ctx, lastDisputer: owner },
    );

    assert.equal(display.label, "Dispute opened");
    assert.deepEqual(display.badges, ["Owner-initiated"]);
  });

  it("labels dispute withdrawal separately from opening dispute", () => {
    const display = getRecordDisplay(
      record({
        recordType: "discrepancy",
        author: disputer,
        description: `${DISPUTE_WITHDRAWN_PREFIX} withdrawn`,
      }),
      ctx,
    );

    assert.equal(display.label, "Dispute withdrawn (signal)");
    assert.equal(display.severity, "info");
  });

  it("labels third-party discrepancy as a light report", () => {
    const display = getRecordDisplay(
      record({
        recordType: "discrepancy",
        author: thirdParty,
        description: "Possible tampering",
      }),
      ctx,
    );

    assert.equal(display.label, "Discrepancy report");
    assert.deepEqual(display.badges, []);
  });

  it("builds evidence links from ar:// URIs", () => {
    const display = getRecordDisplay(
      record({
        recordType: "service",
        evidenceCID: "ar://evidence-123",
      }),
      ctx,
    );

    assert.equal(display.evidenceHref, "https://arweave.net/evidence-123");
  });
});

describe("getDisputeBannerText", () => {
  it("prefers indexed disputeReason over generic fallback", () => {
    assert.equal(
      getDisputeBannerText({
        disputeReason: "  VIN typo  ",
        fallback: "Generic banner",
      }),
      "VIN typo",
    );
  });

  it("uses fallback when disputeReason is empty", () => {
    assert.equal(
      getDisputeBannerText({ disputeReason: "", fallback: "Generic banner" }),
      "Generic banner",
    );
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  needsBuyRiskAck,
  showFixedAfterDisputeBanner,
} from "../lib/passport/trust-signals.ts";

describe("needsBuyRiskAck", () => {
  it("requires ack for UNVERIFIED", () => {
    assert.equal(
      needsBuyRiskAck({ passportStatus: "UNVERIFIED", duplicateVin: false }),
      true,
    );
  });

  it("requires ack for DISPUTED", () => {
    assert.equal(
      needsBuyRiskAck({ passportStatus: "DISPUTED", duplicateVin: false }),
      true,
    );
  });

  it("requires ack for duplicate VIN even when VERIFIED", () => {
    assert.equal(
      needsBuyRiskAck({ passportStatus: "VERIFIED", duplicateVin: true }),
      true,
    );
  });

  it("skips ack for clean VERIFIED listing", () => {
    assert.equal(
      needsBuyRiskAck({ passportStatus: "VERIFIED", duplicateVin: false }),
      false,
    );
  });
});

describe("showFixedAfterDisputeBanner", () => {
  it("shows when metadata changed after verification reset", () => {
    assert.equal(
      showFixedAfterDisputeBanner({
        hadDispute: true,
        status: "UNVERIFIED",
        lastMetadataChangeAt: "200",
        lastVerificationResetAt: "100",
        lastDisputeResolvedAt: "0",
      }),
      true,
    );
  });

  it("shows when metadata changed after dispute resolution", () => {
    assert.equal(
      showFixedAfterDisputeBanner({
        hadDispute: true,
        status: "UNVERIFIED",
        lastMetadataChangeAt: "200",
        lastVerificationResetAt: "0",
        lastDisputeResolvedAt: "150",
      }),
      true,
    );
  });

  it("hides when still VERIFIED", () => {
    assert.equal(
      showFixedAfterDisputeBanner({
        hadDispute: true,
        status: "VERIFIED",
        lastMetadataChangeAt: "200",
        lastVerificationResetAt: "100",
        lastDisputeResolvedAt: "150",
      }),
      false,
    );
  });

  it("hides when no metadata change after reset", () => {
    assert.equal(
      showFixedAfterDisputeBanner({
        hadDispute: true,
        status: "UNVERIFIED",
        lastMetadataChangeAt: "100",
        lastVerificationResetAt: "100",
        lastDisputeResolvedAt: "0",
      }),
      false,
    );
  });
});

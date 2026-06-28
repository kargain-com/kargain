import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { IndexedPassportMetadata } from "../lib/passport/index-passport-metadata.ts";
import {
  DISPUTE_WITHDRAWN_PREFIX,
  isDisputeWithdrawnRecord,
} from "../lib/passport/index-passport-metadata.ts";
import {
  disputeOutcomeUpholdsVerification,
  disputeResolvedTrustFields,
  disputeWithdrawnTrustFields,
  hadDisputeAfterResolve,
  nextVerificationResetCount,
  passportDisputedTrustFields,
  passportMintTrustFields,
  passportUriUpdatedTrustFields,
  verificationResetTrustFields,
} from "../src/lib/ponder-g1-fields.ts";
import { passportMetadataDenorm } from "../src/lib/ponder-passport-metadata.ts";

describe("isDisputeWithdrawnRecord", () => {
  it("matches D6 convention for last disputer", () => {
    assert.equal(
      isDisputeWithdrawnRecord(
        "discrepancy",
        `${DISPUTE_WITHDRAWN_PREFIX} note`,
        "0xAbc",
        "0xabc",
      ),
      true,
    );
  });

  it("rejects other authors", () => {
    assert.equal(
      isDisputeWithdrawnRecord(
        "discrepancy",
        `${DISPUTE_WITHDRAWN_PREFIX} note`,
        "0xOther",
        "0xabc",
      ),
      false,
    );
  });

  it("rejects non-discrepancy records", () => {
    assert.equal(
      isDisputeWithdrawnRecord(
        "service",
        `${DISPUTE_WITHDRAWN_PREFIX} note`,
        "0xAbc",
        "0xabc",
      ),
      false,
    );
  });
});

describe("ponder G1 trust fields", () => {
  it("maps v2 DisputeOutcome to uphold flag", () => {
    assert.equal(disputeOutcomeUpholdsVerification(0), false);
    assert.equal(disputeOutcomeUpholdsVerification(1), true);
  });

  it("sets VERIFIED on dispute withdrawn", () => {
    const fields = disputeWithdrawnTrustFields(100n);
    assert.equal(fields.status, "VERIFIED");
    assert.equal(fields.disputeOpenedAt, 0n);
    assert.equal(fields.disputeWithdrawnAt, 100n);
    assert.equal(fields.disputeDeposit, null);
  });

  it("sets lastMetadataChangeAt on mint", () => {
    const ts = 100n;
    const fields = passportMintTrustFields(ts);
    assert.equal(fields.lastMetadataChangeAt, ts);
    assert.equal(fields.createdAt, ts);
    assert.equal(fields.updatedAt, ts);
  });

  it("sets hadDispute on dispute", () => {
    const fields = passportDisputedTrustFields(200n);
    assert.equal(fields.hadDispute, true);
    assert.equal(fields.status, "DISPUTED");
    assert.equal(fields.disputeOpenedAt, 200n);
  });

  it("clears disputeOpenedAt on resolve", () => {
    const reject = disputeResolvedTrustFields(false, 300n);
    assert.equal(reject.disputeOpenedAt, 0n);
    assert.equal(reject.disputeDeposit, null);
    const uphold = disputeResolvedTrustFields(true, 300n);
    assert.equal(uphold.disputeOpenedAt, 0n);
    assert.equal(uphold.disputeDeposit, null);
  });

  it("keeps hadDispute sticky after resolve", () => {
    assert.equal(hadDisputeAfterResolve(true), true);
    const reject = disputeResolvedTrustFields(false, 300n);
    assert.equal("hadDispute" in reject, false);
    assert.equal(hadDisputeAfterResolve(true), true);
  });

  it("increments verificationResetCount", () => {
    assert.equal(nextVerificationResetCount(0), 1);
    assert.equal(nextVerificationResetCount(2), 3);
    const fields = verificationResetTrustFields(1, 400n);
    assert.equal(fields.verificationResetCount, 2);
    assert.equal(fields.lastVerificationResetAt, 400n);
  });

  it("updates lastMetadataChangeAt on URI update", () => {
    const ts = 500n;
    const fields = passportUriUpdatedTrustFields(ts);
    assert.equal(fields.lastMetadataChangeAt, ts);
    assert.equal(fields.updatedAt, ts);
  });
});

describe("passportMetadataDenorm", () => {
  it("maps fuel/body/transmission from indexed metadata", () => {
    const indexed: IndexedPassportMetadata = {
      vin: "1HGBH41JXMN109186",
      make: "Honda",
      model: "Civic",
      year: 2021,
      mileageKm: 12000,
      fuelType: "Petrol",
      bodyType: "Sedan",
      transmission: "Manual",
      condition: "",
      vehicleType: "",
      colour: "",
      locationLabel: "",
      coverPhotoUri: "ar://cover-tx",
    };
    assert.deepEqual(passportMetadataDenorm(indexed), {
      vin: "1HGBH41JXMN109186",
      make: "Honda",
      model: "Civic",
      year: 2021,
      mileageKm: 12000,
      fuelType: "Petrol",
      bodyType: "Sedan",
      transmission: "Manual",
      condition: "",
      vehicleType: "",
      colour: "",
      locationLabel: "",
      coverPhotoUri: "ar://cover-tx",
    });
  });
});

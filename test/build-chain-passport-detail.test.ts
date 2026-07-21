import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildChainPassportStub } from "../lib/passport/build-chain-passport-detail.ts";
import type { PassportMetadata } from "../lib/passport/fetch-arweave-metadata.ts";

const TOKEN_ID = "28764749040560770193485982315422230450798592";
const OWNER = "0x1111111111111111111111111111111111111111";
const TOKEN_URI = "ar://abc123";
const CHAIN_ID = 84532;

const sampleMetadata: PassportMetadata = {
  version: "1.1",
  vin: "1HGBH41JXMN109186",
  make: "Honda",
  model: "Civic",
  year: 2020,
  mileageKm: 45000,
  photos: ["ar://photo1"],
  fuelType: "Petrol",
  bodyType: "Sedan",
  transmission: "Automatic",
};

describe("buildChainPassportStub", () => {
  it("builds minimal UNVERIFIED passport with empty metadata", () => {
    const passport = buildChainPassportStub(
      TOKEN_ID,
      OWNER,
      TOKEN_URI,
      "UNVERIFIED",
      null,
      CHAIN_ID,
    );

    assert.equal(passport.id, TOKEN_ID);
    assert.equal(passport.chainId, CHAIN_ID);
    assert.equal(passport.custodyChain, CHAIN_ID);
    assert.equal(passport.owner, OWNER);
    assert.equal(passport.status, "UNVERIFIED");
    assert.equal(passport.tokenUri, TOKEN_URI);
    assert.equal(passport.verifier, "");
    assert.equal(passport.verifiedAt, "0");
    assert.equal(passport.vin, "");
    assert.equal(passport.make, "");
    assert.equal(passport.model, "");
    assert.equal(passport.year, 0);
    assert.equal(passport.mileageKm, 0);
    assert.equal(passport.records.length, 0);
    assert.equal(passport.uriHistory.length, 0);
    assert.equal(passport.verificationResetCount, 0);
    assert.equal(passport.hadDispute, false);
    assert.equal(passport.duplicateVin, false);
  });

  it("denorms vehicle fields from metadata", () => {
    const passport = buildChainPassportStub(
      TOKEN_ID,
      OWNER,
      TOKEN_URI,
      "UNVERIFIED",
      sampleMetadata,
      CHAIN_ID,
    );

    assert.equal(passport.vin, sampleMetadata.vin);
    assert.equal(passport.make, sampleMetadata.make);
    assert.equal(passport.model, sampleMetadata.model);
    assert.equal(passport.year, sampleMetadata.year);
    assert.equal(passport.mileageKm, sampleMetadata.mileageKm);
    assert.equal(passport.fuelType, sampleMetadata.fuelType);
    assert.equal(passport.bodyType, sampleMetadata.bodyType);
    assert.equal(passport.transmission, sampleMetadata.transmission);
  });

  it("uses safe defaults for trust and dispute fields", () => {
    const passport = buildChainPassportStub(
      TOKEN_ID,
      OWNER,
      TOKEN_URI,
      "VERIFIED",
      null,
      CHAIN_ID,
    );

    assert.equal(passport.status, "VERIFIED");
    assert.equal(passport.lastDisputer, "");
    assert.equal(passport.disputeReason, "");
    assert.equal(passport.disputeWithdrawnAt, "0");
    assert.equal(passport.lastVerificationResetAt, "0");
    assert.equal(passport.lastMetadataChangeAt, "0");
    assert.equal(passport.lastDisputeResolvedAt, "0");
    assert.equal(passport.disputeOpenedAt, "0");
    assert.equal(passport.createdAt, "0");
    assert.equal(passport.updatedAt, "0");
  });
});

describe("PassportDetailResult indexerPending", () => {
  it("chain fallback success includes indexerPending flag", () => {
    const result = {
      ok: true as const,
      passport: buildChainPassportStub(
        TOKEN_ID,
        OWNER,
        TOKEN_URI,
        "UNVERIFIED",
        sampleMetadata,
        CHAIN_ID,
      ),
      metadata: sampleMetadata,
      indexerPending: true,
    };

    assert.equal(result.ok, true);
    assert.equal(result.indexerPending, true);
    assert.equal(result.passport.id, TOKEN_ID);
    assert.equal(result.metadata?.make, "Honda");
  });
});

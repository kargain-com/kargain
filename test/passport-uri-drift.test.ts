import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { PassportMetadata } from "../lib/passport/metadata-schema.ts";
import {
  effectiveTokenUri,
  hasTokenUriDrift,
  overlayPassportFromMetadata,
} from "../lib/passport/passport-uri-drift.ts";
import type { PonderPassportDetail } from "../lib/types/ponder.ts";

const PONDER_URI = "ar://ponder-old";
const CHAIN_URI = "ar://chain-new";

const sampleMetadata: PassportMetadata = {
  version: "1.1",
  vin: "1HGBH41JXMN109186",
  make: "Honda",
  model: "Accord",
  year: 2021,
  mileageKm: 12000,
  photos: ["ar://photo-new-1", "ar://photo-new-2"],
  fuelType: "Hybrid",
  bodyType: "Sedan",
  transmission: "CVT",
};

const ponderPassport: PonderPassportDetail = {
  id: "28764749040560770193485982315422230450798592",
  owner: "0x1111111111111111111111111111111111111111",
  status: "VERIFIED",
  verifier: "0x2222222222222222222222222222222222222222",
  verifiedAt: "100",
  tokenUri: PONDER_URI,
  vin: "OLDVIN",
  make: "Toyota",
  model: "Camry",
  year: 2018,
  mileageKm: 80000,
  lastDisputer: "",
  disputeReason: "",
  disputeWithdrawnAt: "0",
  lastVerificationResetAt: "0",
  duplicateVin: false,
  lastMetadataChangeAt: "0",
  verificationResetCount: 0,
  hadDispute: false,
  lastDisputeResolvedAt: "0",
  disputeOpenedAt: "0",
  fuelType: "Petrol",
  bodyType: "Coupe",
  transmission: "Manual",
  createdAt: "1",
  updatedAt: "2",
  records: [],
  uriHistory: [],
};

describe("passport-uri-drift", () => {
  it("detects drift when chain URI differs from ponder", () => {
    assert.equal(hasTokenUriDrift(PONDER_URI, CHAIN_URI), true);
    assert.equal(hasTokenUriDrift(PONDER_URI, PONDER_URI), false);
    assert.equal(hasTokenUriDrift(PONDER_URI, null), false);
    assert.equal(hasTokenUriDrift(PONDER_URI, ""), false);
  });

  it("prefers chain URI when drift exists", () => {
    assert.equal(effectiveTokenUri(PONDER_URI, CHAIN_URI), CHAIN_URI);
    assert.equal(effectiveTokenUri(PONDER_URI, PONDER_URI), PONDER_URI);
    assert.equal(effectiveTokenUri(PONDER_URI, null), PONDER_URI);
  });

  it("overlays denorm fields from chain metadata", () => {
    const updated = overlayPassportFromMetadata(ponderPassport, sampleMetadata, CHAIN_URI);

    assert.equal(updated.tokenUri, CHAIN_URI);
    assert.equal(updated.vin, sampleMetadata.vin);
    assert.equal(updated.make, sampleMetadata.make);
    assert.equal(updated.model, sampleMetadata.model);
    assert.equal(updated.year, sampleMetadata.year);
    assert.equal(updated.mileageKm, sampleMetadata.mileageKm);
    assert.equal(updated.fuelType, sampleMetadata.fuelType);
    assert.equal(updated.bodyType, sampleMetadata.bodyType);
    assert.equal(updated.transmission, sampleMetadata.transmission);
    assert.equal(updated.status, ponderPassport.status);
    assert.equal(updated.verifier, ponderPassport.verifier);
  });

  it("drift implies indexerPending in detail responses", () => {
    const uriDrift = hasTokenUriDrift(PONDER_URI, CHAIN_URI);
    const effectiveUri = effectiveTokenUri(PONDER_URI, CHAIN_URI);
    const passport = overlayPassportFromMetadata(
      { ...ponderPassport, tokenUri: effectiveUri },
      sampleMetadata,
      effectiveUri,
    );

    const result = {
      ok: true as const,
      passport,
      metadata: sampleMetadata,
      indexerPending: uriDrift,
    };

    assert.equal(result.indexerPending, true);
    assert.equal(result.passport.tokenUri, CHAIN_URI);
    assert.equal(result.metadata.photos.length, 2);
    assert.equal(result.passport.make, "Honda");
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parsePonderPassport } from "../lib/passport/fetch-passport-detail.ts";

const BASE = {
  id: "1",
  chainId: 84532,
  custodyChain: 84532,
  owner: "0x1111111111111111111111111111111111111111",
  status: "VERIFIED",
  verifier: "",
  verifiedAt: "0",
  tokenUri: "ar://x",
  vin: "",
  make: "",
  model: "",
  year: 0,
  mileageKm: 0,
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
  fuelType: "",
  bodyType: "",
  transmission: "",
  createdAt: "0",
  updatedAt: "0",
  records: [],
  uriHistory: [],
};

describe("parsePonderPassport custody", () => {
  it("parses origin chainId and custodyChain", () => {
    const parsed = parsePonderPassport({
      ...BASE,
      chainId: 84532,
      custodyChain: 11155111,
    });
    assert.ok(parsed);
    assert.equal(parsed.chainId, 84532);
    assert.equal(parsed.custodyChain, 11155111);
  });

  it("fail-closes when custodyChain missing", () => {
    const { custodyChain: _, ...rest } = BASE;
    assert.equal(parsePonderPassport(rest), null);
  });

  it("fail-closes when chainId missing", () => {
    const { chainId: _, ...rest } = BASE;
    assert.equal(parsePonderPassport(rest), null);
  });
});

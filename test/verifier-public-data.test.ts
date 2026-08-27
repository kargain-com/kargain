import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildVerifierDetailQueryUrl } from "../lib/passport/fetch-passport-detail.ts";
import {
  buildVerifierAttestationsQueryUrl,
  buildVerifierPassportsQueryUrl,
} from "../lib/verifier/fetch-verifier-public-data.ts";
import { mapVerifierDetailToProfile } from "../lib/verifier/map-verifier-profile.ts";

const ADDRESS = "0x1234567890123456789012345678901234567890";
const BASE = "http://localhost:42069";

describe("buildVerifierPassportsQueryUrl", () => {
  it("requests VERIFIED passports for the verifier only", () => {
    const url = new URL(buildVerifierPassportsQueryUrl(ADDRESS));
    assert.equal(url.pathname, "/passports");
    assert.equal(url.searchParams.get("verifier"), ADDRESS);
    assert.equal(url.searchParams.get("status"), "VERIFIED");
    assert.equal(url.searchParams.get("limit"), "100");
  });
});

describe("buildVerifierAttestationsQueryUrl", () => {
  it("requests attestations for the verifier", () => {
    const url = new URL(buildVerifierAttestationsQueryUrl(ADDRESS));
    assert.equal(url.pathname, `/verifiers/${ADDRESS}/attestations`);
    assert.equal(url.searchParams.get("limit"), "100");
  });
});

describe("buildVerifierDetailQueryUrl", () => {
  it("omits chainId when unset", () => {
    const url = new URL(buildVerifierDetailQueryUrl(ADDRESS, undefined, BASE));
    assert.equal(url.pathname, `/verifiers/${ADDRESS}`);
    assert.equal(url.searchParams.get("chainId"), null);
  });

  it("appends chainId when set", () => {
    const url = new URL(buildVerifierDetailQueryUrl(ADDRESS, 84532, BASE));
    assert.equal(url.pathname, `/verifiers/${ADDRESS}`);
    assert.equal(url.searchParams.get("chainId"), "84532");
  });
});

describe("mapVerifierDetailToProfile", () => {
  it("maps verificationCount and chainId from ponder detail", () => {
    const profile = mapVerifierDetailToProfile(
      {
        address: ADDRESS,
        chainId: 84532,
        joinedAt: 1_700_000_000,
        verificationCount: 7,
        verificationFee: "50000000000000000",
        identity: {
          category: 1,
          name: "Inspector",
          slug: "inspector",
          metadataURI: "ar://meta",
        },
        stake: { active: true },
      },
      ADDRESS,
    );

    assert.equal(profile.chainId, 84532);
    assert.equal(profile.verificationCount, 7);
    assert.equal(profile.verificationFee, 50_000_000_000_000_000n);
    assert.equal(profile.name, "Inspector");
    assert.equal(profile.active, true);
    assert.equal(profile.joinedAt, 1_700_000_000);
  });

  it("maps missing chainId to 0 (fail-closed placeholder)", () => {
    const profile = mapVerifierDetailToProfile(
      {
        address: ADDRESS,
        identity: { category: 5, name: "", slug: "", metadataURI: "" },
        stake: { active: false },
      },
      ADDRESS,
    );
    assert.equal(profile.chainId, 0);
  });
});

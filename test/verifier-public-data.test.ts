import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildVerifierAttestationsQueryUrl,
  buildVerifierPassportsQueryUrl,
} from "../lib/verifier/fetch-verifier-public-data.ts";
import { mapVerifierDetailToProfile } from "../lib/verifier/map-verifier-profile.ts";

const ADDRESS = "0x1234567890123456789012345678901234567890";
const BASE = "http://localhost:42069";

describe("buildVerifierPassportsQueryUrl", () => {
  it("requests VERIFIED passports for the verifier only", () => {
    const url = new URL(buildVerifierPassportsQueryUrl(ADDRESS, BASE));
    assert.equal(url.pathname, "/passports");
    assert.equal(url.searchParams.get("verifier"), ADDRESS);
    assert.equal(url.searchParams.get("status"), "VERIFIED");
    assert.equal(url.searchParams.get("limit"), "100");
  });
});

describe("buildVerifierAttestationsQueryUrl", () => {
  it("requests attestations for the verifier", () => {
    const url = new URL(buildVerifierAttestationsQueryUrl(ADDRESS, BASE));
    assert.equal(url.pathname, `/verifiers/${ADDRESS}/attestations`);
    assert.equal(url.searchParams.get("limit"), "100");
  });
});

describe("mapVerifierDetailToProfile", () => {
  it("maps verificationCount from ponder detail", () => {
    const profile = mapVerifierDetailToProfile(
      {
        address: ADDRESS,
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
        disputedPassports: [],
      },
      ADDRESS,
    );

    assert.equal(profile.verificationCount, 7);
    assert.equal(profile.verificationFee, 50_000_000_000_000_000n);
    assert.equal(profile.name, "Inspector");
    assert.equal(profile.active, true);
    assert.equal(profile.joinedAt, 1_700_000_000);
  });
});

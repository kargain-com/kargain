import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  isProfilePublishBlockedByRotation,
  isRotatedIdentity,
  resolveExpectedPubkey,
} from "../lib/nostr/identity-rotation.ts";

const ADDRESS = "0xcfe194fea9727bD04dA8F78c2362680986e02dF1" as const;
const DERIVED = "aa".repeat(32);
const EXPECTED = "bb".repeat(32);

describe("isRotatedIdentity", () => {
  it("is false when pubkeys match", () => {
    assert.equal(isRotatedIdentity(DERIVED, DERIVED.toUpperCase()), false);
  });

  it("is true when pubkeys differ", () => {
    assert.equal(isRotatedIdentity(DERIVED, EXPECTED), true);
  });
});

describe("resolveExpectedPubkey", () => {
  it("prefers cached pubkey over relay", async () => {
    let relayCalled = false;
    const pubkey = await resolveExpectedPubkey(ADDRESS, {
      loadCachedPubkey: () => EXPECTED,
      attestedPubkeyForAddress: async () => {
        relayCalled = true;
        return DERIVED;
      },
    });
    assert.equal(pubkey, EXPECTED);
    assert.equal(relayCalled, false);
  });

  it("falls back to attestedPubkeyForAddress when cache empty", async () => {
    const pubkey = await resolveExpectedPubkey(ADDRESS, {
      loadCachedPubkey: () => null,
      attestedPubkeyForAddress: async () => EXPECTED,
    });
    assert.equal(pubkey, EXPECTED);
  });

  it("returns null when cache and relay are empty", async () => {
    const pubkey = await resolveExpectedPubkey(ADDRESS, {
      loadCachedPubkey: () => null,
      attestedPubkeyForAddress: async () => null,
    });
    assert.equal(pubkey, null);
  });
});

describe("isProfilePublishBlockedByRotation", () => {
  it("does not block new users with no expected pubkey", async () => {
    const blocked = await isProfilePublishBlockedByRotation(DERIVED, DERIVED, {
      loadCachedPubkey: () => null,
      attestedPubkeyForAddress: async () => null,
    });
    assert.equal(blocked, false);
  });

  it("does not block when derived matches expected", async () => {
    const blocked = await isProfilePublishBlockedByRotation(DERIVED, DERIVED, {
      loadCachedPubkey: () => DERIVED,
      attestedPubkeyForAddress: async () => null,
    });
    assert.equal(blocked, false);
  });

  it("blocks when expected pubkey exists and differs from derived", async () => {
    const blocked = await isProfilePublishBlockedByRotation(DERIVED, DERIVED, {
      loadCachedPubkey: () => EXPECTED,
      attestedPubkeyForAddress: async () => null,
    });
    assert.equal(blocked, true);
  });

  it("resolves expected from relay when cache empty before gating", async () => {
    const blocked = await isProfilePublishBlockedByRotation(DERIVED, DERIVED, {
      loadCachedPubkey: () => null,
      attestedPubkeyForAddress: async () => EXPECTED,
    });
    assert.equal(blocked, true);
  });
});

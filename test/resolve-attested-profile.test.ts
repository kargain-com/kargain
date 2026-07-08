import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Event } from "nostr-tools";
import { privateKeyToAccount } from "viem/accounts";

import {
  applyVerifiedProfileEntry,
  attestedProfileFilterForAddresses,
  attestedPubkeyForAddress,
  attestedProfileMapFromState,
  clearOwnProfileReattestationCache,
  clearOwnProfileReattestationCacheForTests,
  createEmptyAttestedProfileState,
  ownProfileNeedsReattestation,
  resolveAttestedProfile,
  resolveAttestedProfiles,
  verifyIncomingProfileEvent,
  type AttestedProfileQueryPool,
} from "../lib/nostr/resolve-attested-profile.ts";
import {
  attestationMessage,
  buildProfileAttestation,
  clearProfileAttestationMemoForTests,
} from "../lib/nostr/profile-attestation.ts";

const PRIVATE_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;
const account = privateKeyToAccount(PRIVATE_KEY);
const ADDRESS = account.address;
const PUBKEY = "aa".repeat(32);

async function attestedKind0Event(opts: {
  id: string;
  created_at: number;
  pubkey?: string;
  profile?: Record<string, unknown>;
  address?: typeof ADDRESS;
}): Promise<Event> {
  const pubkey = opts.pubkey ?? PUBKEY;
  const address = opts.address ?? ADDRESS;
  const signature = await account.signMessage({
    message: attestationMessage(pubkey, address),
  });
  const attestation = buildProfileAttestation({ pubkey, address, signature });
  const content = JSON.stringify({ name: "Attested", ...opts.profile, attestation });
  return {
    id: opts.id,
    pubkey,
    content,
    created_at: opts.created_at,
    tags: [["i", `ethereum:${address.toLowerCase()}`]],
    kind: 0,
    sig: "sig",
  } as Event;
}

function spoofKind0Event(opts: {
  id: string;
  created_at: number;
  name?: string;
  address?: typeof ADDRESS;
}): Event {
  const address = opts.address ?? ADDRESS;
  return {
    id: opts.id,
    pubkey: "bb".repeat(32),
    content: JSON.stringify({ name: opts.name ?? "Spoof" }),
    created_at: opts.created_at,
    tags: [["i", `ethereum:${address.toLowerCase()}`]],
    kind: 0,
    sig: "sig",
  } as Event;
}

function fakePool(events: Event[]): AttestedProfileQueryPool {
  return {
    querySync: async () => events,
  };
}

describe("attestedProfileFilterForAddresses", () => {
  it("dedupes and lowercases ethereum identity tags", () => {
    const filter = attestedProfileFilterForAddresses([
      "0xAbCdEf1111111111111111111111111111111111",
      "0xabcdef1111111111111111111111111111111111",
      "0x2222222222222222222222222222222222222222",
    ]);

    assert.deepEqual(filter["#i"], [
      "ethereum:0xabcdef1111111111111111111111111111111111",
      "ethereum:0x2222222222222222222222222222222222222222",
    ]);
    assert.equal(filter.kinds?.[0], 0);
    assert.equal(filter.limit, 4);
  });
});

describe("resolveAttestedProfile", () => {
  it("returns newest verified profile when newer event is spoofed", async () => {
    clearProfileAttestationMemoForTests();
    const spoof = spoofKind0Event({ id: "spoof", created_at: 200, name: "Spoofed" });
    const attested = await attestedKind0Event({
      id: "attested",
      created_at: 100,
      profile: { lud16: "real@example.com" },
    });

    const profile = await resolveAttestedProfile(ADDRESS, {
      pool: fakePool([spoof, attested]),
    });

    assert.equal(profile?.lud16, "real@example.com");
    assert.notEqual(profile?.name, "Spoofed");
  });

  it("returns null when no event verifies", async () => {
    clearProfileAttestationMemoForTests();
    const spoof = spoofKind0Event({ id: "spoof", created_at: 200 });

    const profile = await resolveAttestedProfile(ADDRESS, {
      pool: fakePool([spoof]),
    });

    assert.equal(profile, null);
  });

  it("fail-closed on verify errors", async () => {
    clearProfileAttestationMemoForTests();
    const bad = spoofKind0Event({
      id: "bad",
      created_at: 100,
      name: "Bad",
    });
    bad.content = "not-json";

    const profile = await resolveAttestedProfile(ADDRESS, {
      pool: fakePool([bad]),
    });

    assert.equal(profile, null);
  });
});

describe("resolveAttestedProfiles", () => {
  it("includes only verified profiles per address", async () => {
    clearProfileAttestationMemoForTests();
    const addr2 = "0x2222222222222222222222222222222222222222" as const;

    const verified1 = await attestedKind0Event({
      id: "v1",
      created_at: 100,
      profile: { lud16: "a@example.com" },
    });
    const spoof2 = spoofKind0Event({
      id: "s2",
      created_at: 200,
      address: addr2,
      name: "Spoof2",
    });

    const map = await resolveAttestedProfiles([ADDRESS, addr2], {
      pool: fakePool([verified1, spoof2]),
    });

    assert.equal(map.get(ADDRESS.toLowerCase())?.lud16, "a@example.com");
    assert.equal(map.get(addr2.toLowerCase()), null);
  });
});

describe("verifyIncomingProfileEvent + batch accumulator", () => {
  it("rejects unverified events", async () => {
    clearProfileAttestationMemoForTests();
    const spoof = spoofKind0Event({ id: "spoof", created_at: 100 });
    assert.equal(await verifyIncomingProfileEvent(spoof), null);
  });

  it("accumulates verified profiles and keeps newest verified per address", async () => {
    clearProfileAttestationMemoForTests();
    let state = createEmptyAttestedProfileState();

    const older = await verifyIncomingProfileEvent(
      await attestedKind0Event({
        id: "old",
        created_at: 100,
        profile: { lud16: "old@example.com" },
      }),
    );
    assert.ok(older);
    state = applyVerifiedProfileEntry(state, older);

    const newerSpoof = await verifyIncomingProfileEvent(
      spoofKind0Event({ id: "spoof", created_at: 200, name: "Spoof" }),
    );
    assert.equal(newerSpoof, null);

    const newerVerified = await verifyIncomingProfileEvent(
      await attestedKind0Event({
        id: "new",
        created_at: 300,
        profile: { lud16: "new@example.com" },
      }),
    );
    assert.ok(newerVerified);
    state = applyVerifiedProfileEntry(state, newerVerified);

    const map = attestedProfileMapFromState(state);
    assert.equal(map.get(ADDRESS.toLowerCase())?.lud16, "new@example.com");
  });
});

describe("ownProfileNeedsReattestation", () => {
  it("returns false when only attested events exist", async () => {
    clearProfileAttestationMemoForTests();
    clearOwnProfileReattestationCacheForTests();
    const attested = await attestedKind0Event({ id: "attested", created_at: 100 });

    const needs = await ownProfileNeedsReattestation(ADDRESS, {
      pool: fakePool([attested]),
    });

    assert.equal(needs, false);
  });

  it("returns true when only unattested events exist", async () => {
    clearProfileAttestationMemoForTests();
    clearOwnProfileReattestationCacheForTests();
    const spoof = spoofKind0Event({ id: "spoof", created_at: 200 });

    const needs = await ownProfileNeedsReattestation(ADDRESS, {
      pool: fakePool([spoof]),
    });

    assert.equal(needs, true);
  });

  it("returns false when both spoofed and attested events exist", async () => {
    clearProfileAttestationMemoForTests();
    clearOwnProfileReattestationCacheForTests();
    const spoof = spoofKind0Event({ id: "spoof", created_at: 200 });
    const attested = await attestedKind0Event({ id: "attested", created_at: 100 });

    const needs = await ownProfileNeedsReattestation(ADDRESS, {
      pool: fakePool([spoof, attested]),
    });

    assert.equal(needs, false);
  });

  it("returns false when no events exist", async () => {
    clearOwnProfileReattestationCacheForTests();

    const needs = await ownProfileNeedsReattestation(ADDRESS, {
      pool: fakePool([]),
    });

    assert.equal(needs, false);
  });

  it("memoizes per address until cache is cleared", async () => {
    clearProfileAttestationMemoForTests();
    clearOwnProfileReattestationCacheForTests();
    let queryCount = 0;
    const pool: AttestedProfileQueryPool = {
      querySync: async () => {
        queryCount += 1;
        return [spoofKind0Event({ id: "spoof", created_at: 100 })];
      },
    };

    assert.equal(await ownProfileNeedsReattestation(ADDRESS, { pool }), true);
    assert.equal(await ownProfileNeedsReattestation(ADDRESS, { pool }), true);
    assert.equal(queryCount, 1);

    clearOwnProfileReattestationCache(ADDRESS);
    assert.equal(await ownProfileNeedsReattestation(ADDRESS, { pool }), true);
    assert.equal(queryCount, 2);
  });
});

describe("attestedPubkeyForAddress", () => {
  it("returns pubkey only from verified events", async () => {
    clearProfileAttestationMemoForTests();
    const spoof = spoofKind0Event({ id: "spoof", created_at: 200 });
    const attested = await attestedKind0Event({ id: "attested", created_at: 100 });

    const pubkey = await attestedPubkeyForAddress(ADDRESS, {
      pool: fakePool([spoof, attested]),
    });

    assert.equal(pubkey, PUBKEY);
  });

  it("returns null when no verified event exists", async () => {
    clearProfileAttestationMemoForTests();
    const spoof = spoofKind0Event({ id: "spoof", created_at: 200 });

    const pubkey = await attestedPubkeyForAddress(ADDRESS, {
      pool: fakePool([spoof]),
    });

    assert.equal(pubkey, null);
  });
});

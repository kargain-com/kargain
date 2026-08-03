import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { Event, Filter } from "nostr-tools";
import { privateKeyToAccount } from "viem/accounts";

import {
  setAppEventStorePoolForTest,
  type AppEventQueryPool,
  type AppEventRelay,
} from "../lib/nostr/app-event-store.ts";
import {
  clearCachedPubkey,
  loadCachedPubkey,
  loadCachedPubkeyBinding,
  saveCachedPubkey,
} from "../lib/nostr/nostr-pubkey-cache.ts";
import {
  applyVerifiedProfileEntry,
  ATTESTED_PROFILE_CREATED_AT_SKEW_SECONDS,
  attestedProfileFilterForAddress,
  attestedProfileFilterForAuthor,
  attestedPubkeyForAddress,
  attestedPubkeysForAddresses,
  attestedProfileMapFromState,
  createEmptyAttestedProfileState,
  isCreatedAtWithinReadSkew,
  KIND0_PER_ADDRESS_LIMIT,
  preP5bEclipseOraclePick,
  resolveAttestedProfile,
  resolveAttestedProfiles,
  verifyIncomingProfileEvent,
} from "../lib/nostr/resolve-attested-profile.ts";
import {
  attestationMessage,
  buildProfileAttestation,
  clearProfileAttestationMemoForTests,
} from "../lib/nostr/profile-attestation.ts";
import { readMessagingIntent } from "../lib/nostr/messaging-intent.ts";

const PRIVATE_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;
const account = privateKeyToAccount(PRIVATE_KEY);
const ADDRESS = account.address;
const PUBKEY = "aa".repeat(32);
const CHALLENGER_PUBKEY = "cc".repeat(32);

const memoryStore = new Map<string, string>();

function installLocalStorage(): void {
  memoryStore.clear();
  (globalThis as { window?: unknown }).window = {
    localStorage: {
      getItem(key: string) {
        return memoryStore.get(key) ?? null;
      },
      setItem(key: string, value: string) {
        memoryStore.set(key, value);
      },
      removeItem(key: string) {
        memoryStore.delete(key);
      },
    },
  };
}

async function attestedKind0Event(opts: {
  id: string;
  created_at: number;
  pubkey?: string;
  profile?: Record<string, unknown>;
  address?: typeof ADDRESS;
  signWith?: typeof account;
}): Promise<Event> {
  const pubkey = opts.pubkey ?? PUBKEY;
  const address = opts.address ?? ADDRESS;
  const signer = opts.signWith ?? account;
  const signature = await signer.signMessage({
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

type CoveragePool = AppEventQueryPool & {
  issuedFilters: Filter[];
};

/** Coverage pool that serves a fixed event list to every relay (EOSE). */
function coveragePool(events: Event[]): CoveragePool {
  const issuedFilters: Filter[] = [];
  const pool: CoveragePool = {
    issuedFilters,
    async ensureRelay() {
      const relay: AppEventRelay = {
        subscribe(filters, params) {
          for (const f of filters) issuedFilters.push(f);
          queueMicrotask(() => {
            for (const event of events) {
              params.onevent?.(event);
            }
            params.oneose?.();
          });
          return { close() {} };
        },
      };
      return relay;
    },
  };
  return pool;
}

afterEach(() => {
  setAppEventStorePoolForTest(null);
  clearProfileAttestationMemoForTests();
  clearCachedPubkey(ADDRESS);
  memoryStore.clear();
});

describe("created_at read skew", () => {
  it("exports a positive skew constant used by the bound", () => {
    assert.equal(ATTESTED_PROFILE_CREATED_AT_SKEW_SECONDS, 3600);
    assert.ok(isCreatedAtWithinReadSkew(0, 1_000_000));
  });

  it("discards events beyond now + skew", () => {
    const now = 1_700_000_000;
    assert.equal(
      isCreatedAtWithinReadSkew(now + ATTESTED_PROFILE_CREATED_AT_SKEW_SECONDS + 1, now),
      false,
    );
  });

  it("accepts events within skew ahead and any past", () => {
    const now = 1_700_000_000;
    assert.equal(
      isCreatedAtWithinReadSkew(now + ATTESTED_PROFILE_CREATED_AT_SKEW_SECONDS, now),
      true,
    );
    assert.equal(isCreatedAtWithinReadSkew(now - 86_400, now), true);
    assert.equal(isCreatedAtWithinReadSkew(now - 1, now), true);
  });
});

describe("attestedProfileFilterForAddress", () => {
  it("builds a single-address #i filter with per-address limit", () => {
    const filter = attestedProfileFilterForAddress(
      "0xAbCdEf1111111111111111111111111111111111",
    );
    assert.deepEqual(filter["#i"], [
      "ethereum:0xabcdef1111111111111111111111111111111111",
    ]);
    assert.equal(filter.kinds?.[0], 0);
    assert.equal(filter.limit, KIND0_PER_ADDRESS_LIMIT);
    assert.equal(filter.authors, undefined);
  });

  it("author filter has no identity tag", () => {
    const filter = attestedProfileFilterForAuthor(PUBKEY);
    assert.deepEqual(filter.authors, [PUBKEY]);
    assert.equal(filter["#i"], undefined);
    assert.equal(filter.limit, KIND0_PER_ADDRESS_LIMIT);
  });
});

describe("resolveAttestedProfile", () => {
  it("returns newest verified profile when newer event is spoofed", async () => {
    installLocalStorage();
    const spoof = spoofKind0Event({ id: "spoof", created_at: 200, name: "Spoofed" });
    const attested = await attestedKind0Event({
      id: "attested",
      created_at: 100,
      profile: { lud16: "real@example.com" },
    });
    const pool = coveragePool([spoof, attested]);
    setAppEventStorePoolForTest(pool as never);

    const profile = await resolveAttestedProfile(ADDRESS, { pool, nowSec: 1_000 });

    assert.equal(profile?.lud16, "real@example.com");
    assert.notEqual(profile?.name, "Spoofed");
  });

  it("returns null when no event verifies", async () => {
    installLocalStorage();
    const spoof = spoofKind0Event({ id: "spoof", created_at: 200 });
    const pool = coveragePool([spoof]);
    setAppEventStorePoolForTest(pool as never);

    const profile = await resolveAttestedProfile(ADDRESS, { pool, nowSec: 1_000 });
    assert.equal(profile, null);
  });

  it("discards a verifying event dated beyond skew", async () => {
    installLocalStorage();
    const now = 1_700_000_000;
    const future = await attestedKind0Event({
      id: "future",
      created_at: now + ATTESTED_PROFILE_CREATED_AT_SKEW_SECONDS + 60,
      profile: { lud16: "future@example.com" },
    });
    const current = await attestedKind0Event({
      id: "current",
      created_at: now - 60,
      profile: { lud16: "current@example.com" },
    });
    const pool = coveragePool([future, current]);
    setAppEventStorePoolForTest(pool as never);

    const profile = await resolveAttestedProfile(ADDRESS, { pool, nowSec: now });
    assert.equal(profile?.lud16, "current@example.com");
  });

  it("accepts a verifying event slightly ahead within skew", async () => {
    installLocalStorage();
    const now = 1_700_000_000;
    const slight = await attestedKind0Event({
      id: "slight",
      created_at: now + 30,
      profile: { lud16: "slight@example.com" },
    });
    const pool = coveragePool([slight]);
    setAppEventStorePoolForTest(pool as never);

    const profile = await resolveAttestedProfile(ADDRESS, { pool, nowSec: now });
    assert.equal(profile?.lud16, "slight@example.com");
  });
});

describe("RC-22 eclipse attack", () => {
  it("genuine profile still resolves when future spoofs would fill the old budget", async () => {
    installLocalStorage();
    const now = 1_700_000_000;
    const oldSharedLimit = 2;
    const spoof1 = spoofKind0Event({
      id: "s1",
      created_at: now + 10_000,
      name: "Eclipse1",
    });
    const spoof2 = spoofKind0Event({
      id: "s2",
      created_at: now + 9_000,
      name: "Eclipse2",
    });
    const genuine = await attestedKind0Event({
      id: "genuine",
      created_at: now - 100,
      profile: { lud16: "genuine@example.com", name: "Genuine" },
    });
    const planted = [spoof1, spoof2, genuine];

    // Oracle: pre-P5b shared limit=2 newest-first would never see the genuine event.
    const truncated = preP5bEclipseOraclePick(planted, oldSharedLimit);
    assert.equal(truncated.length, 2);
    assert.ok(truncated.every((e) => e.id !== "genuine"));
    assert.equal(
      truncated.some((e) => e.id === "genuine"),
      false,
      "regression: old budget would have dropped the genuine event",
    );

    const pool = coveragePool(planted);
    setAppEventStorePoolForTest(pool as never);
    const profile = await resolveAttestedProfile(ADDRESS, { pool, nowSec: now });
    assert.equal(profile?.lud16, "genuine@example.com");
    assert.equal(profile?.name, "Genuine");
  });

  it("batch: spoofs on address A do not blank address B", async () => {
    installLocalStorage();
    const now = 1_700_000_000;
    const addrA = "0x3333333333333333333333333333333333333333" as const;
    const addrB = ADDRESS;
    clearCachedPubkey(addrA);

    const spoofsForA = [
      spoofKind0Event({ id: "ea1", created_at: now + 10_000, address: addrA }),
      spoofKind0Event({ id: "ea2", created_at: now + 9_000, address: addrA }),
    ];
    const genuineForB = await attestedKind0Event({
      id: "eb",
      created_at: now - 40,
      profile: { lud16: "b@example.com" },
    });

    const pool = coveragePool([...spoofsForA, genuineForB]);
    setAppEventStorePoolForTest(pool as never);

    const map = await resolveAttestedProfiles([addrA, addrB], { pool, nowSec: now });
    assert.equal(map.get(addrA.toLowerCase()), null);
    assert.equal(map.get(addrB.toLowerCase())?.lud16, "b@example.com");
  });
});

describe("author path and pin", () => {
  it("with cached pubkey issues author filter only (no #i)", async () => {
    installLocalStorage();
    const now = 1_700_000_000;
    saveCachedPubkey(ADDRESS, PUBKEY, now - 100);
    const attested = await attestedKind0Event({
      id: "attested",
      created_at: now - 50,
      profile: { lud16: "cached@example.com" },
    });
    const pool = coveragePool([attested]);
    setAppEventStorePoolForTest(pool as never);

    const profile = await resolveAttestedProfile(ADDRESS, { pool, nowSec: now });
    assert.equal(profile?.lud16, "cached@example.com");
    assert.ok(pool.issuedFilters.length > 0);
    for (const f of pool.issuedFilters) {
      assert.equal(f["#i"], undefined, "author path must not query identity tags");
      assert.deepEqual(f.authors, [PUBKEY]);
    }
  });

  it("unverified event never populates the cache", async () => {
    installLocalStorage();
    const now = 1_700_000_000;
    const spoof = spoofKind0Event({ id: "spoof", created_at: now - 10 });
    const pool = coveragePool([spoof]);
    setAppEventStorePoolForTest(pool as never);

    await resolveAttestedProfile(ADDRESS, { pool, nowSec: now });
    assert.equal(loadCachedPubkey(ADDRESS), null);
  });

  it("verifying newer challenger replaces the pin", async () => {
    installLocalStorage();
    const now = 1_700_000_000;
    saveCachedPubkey(ADDRESS, PUBKEY, now - 200);

    const challenger = await attestedKind0Event({
      id: "challenger",
      created_at: now - 10,
      pubkey: CHALLENGER_PUBKEY,
      profile: { lud16: "challenger@example.com" },
    });

    // Author path empty → discovery fallback sees verifying challenger.
    const emptyThenChallenger: CoveragePool = {
      issuedFilters: [],
      async ensureRelay() {
        const relay: AppEventRelay = {
          subscribe(filters, params) {
            emptyThenChallenger.issuedFilters.push(...filters);
            queueMicrotask(() => {
              const isAuthor = Boolean(filters[0]?.authors);
              if (!isAuthor) {
                params.onevent?.(challenger);
              }
              params.oneose?.();
            });
            return { close() {} };
          },
        };
        return relay;
      },
    };
    setAppEventStorePoolForTest(emptyThenChallenger as never);

    const profile = await resolveAttestedProfile(ADDRESS, {
      pool: emptyThenChallenger,
      nowSec: now,
    });
    assert.equal(profile?.lud16, "challenger@example.com");
    assert.equal(loadCachedPubkey(ADDRESS), CHALLENGER_PUBKEY);
    assert.ok(
      (loadCachedPubkeyBinding(ADDRESS)?.boundCreatedAt ?? 0) > now - 200,
    );
  });

  it("non-verifying challenger never replaces the pin", async () => {
    installLocalStorage();
    const now = 1_700_000_000;
    saveCachedPubkey(ADDRESS, PUBKEY, now - 200);
    const pinned = await attestedKind0Event({
      id: "pinned",
      created_at: now - 100,
      profile: { lud16: "pinned@example.com" },
    });
    const spoof = spoofKind0Event({
      id: "chal",
      created_at: now - 5,
      name: "ChallengerSpoof",
    });
    const pool = coveragePool([pinned, spoof]);
    setAppEventStorePoolForTest(pool as never);

    const profile = await resolveAttestedProfile(ADDRESS, { pool, nowSec: now });
    assert.equal(profile?.lud16, "pinned@example.com");
    assert.equal(loadCachedPubkey(ADDRESS), PUBKEY);
  });

  it("cold and warm cache agree for honest data", async () => {
    installLocalStorage();
    const now = 1_700_000_000;
    const attested = await attestedKind0Event({
      id: "honest",
      created_at: now - 80,
      profile: { lud16: "honest@example.com", name: "Honest" },
    });
    const pool = coveragePool([attested]);
    setAppEventStorePoolForTest(pool as never);

    clearCachedPubkey(ADDRESS);
    const cold = await resolveAttestedProfile(ADDRESS, { pool, nowSec: now });
    assert.ok(loadCachedPubkey(ADDRESS));

    const warm = await resolveAttestedProfile(ADDRESS, { pool, nowSec: now });
    assert.deepEqual(cold, warm);
    assert.equal(warm?.lud16, "honest@example.com");
  });
});

describe("resolveAttestedProfiles / commons path", () => {
  it("attestedPubkeysForAddresses survives planted eclipse", async () => {
    installLocalStorage();
    const now = 1_700_000_000;
    const spoofs = [
      spoofKind0Event({ id: "c1", created_at: now + 10_000 }),
      spoofKind0Event({ id: "c2", created_at: now + 9_000 }),
    ];
    const genuine = await attestedKind0Event({
      id: "c-good",
      created_at: now - 20,
    });
    const pool = coveragePool([...spoofs, genuine]);
    setAppEventStorePoolForTest(pool as never);

    const map = await attestedPubkeysForAddresses([ADDRESS], { pool, nowSec: now });
    assert.equal(map.get(ADDRESS.toLowerCase()), PUBKEY);
  });
});

describe("verifyIncomingProfileEvent + batch accumulator", () => {
  it("rejects unverified events", async () => {
    const spoof = spoofKind0Event({ id: "spoof", created_at: 100 });
    assert.equal(await verifyIncomingProfileEvent(spoof, 1_000), null);
  });

  it("rejects beyond-skew even when attested", async () => {
    const now = 1_700_000_000;
    const future = await attestedKind0Event({
      id: "fut",
      created_at: now + ATTESTED_PROFILE_CREATED_AT_SKEW_SECONDS + 1,
    });
    assert.equal(await verifyIncomingProfileEvent(future, now), null);
  });

  it("accumulates verified profiles and keeps newest verified per address", async () => {
    let state = createEmptyAttestedProfileState();

    const older = await verifyIncomingProfileEvent(
      await attestedKind0Event({
        id: "old",
        created_at: 100,
        profile: { lud16: "old@example.com" },
      }),
      1_000,
    );
    assert.ok(older);
    state = applyVerifiedProfileEntry(state, older);

    const newerSpoof = await verifyIncomingProfileEvent(
      spoofKind0Event({ id: "spoof", created_at: 200, name: "Spoof" }),
      1_000,
    );
    assert.equal(newerSpoof, null);

    const newerVerified = await verifyIncomingProfileEvent(
      await attestedKind0Event({
        id: "new",
        created_at: 300,
        profile: { lud16: "new@example.com" },
      }),
      1_000,
    );
    assert.ok(newerVerified);
    state = applyVerifiedProfileEntry(state, newerVerified);

    const map = attestedProfileMapFromState(state);
    assert.equal(map.get(ADDRESS.toLowerCase())?.lud16, "new@example.com");
  });
});

describe("attestedPubkeyForAddress", () => {
  it("returns pubkey only from verified events", async () => {
    installLocalStorage();
    const spoof = spoofKind0Event({ id: "spoof", created_at: 200 });
    const attested = await attestedKind0Event({ id: "attested", created_at: 100 });
    const pool = coveragePool([spoof, attested]);
    setAppEventStorePoolForTest(pool as never);

    const pubkey = await attestedPubkeyForAddress(ADDRESS, { pool, nowSec: 1_000 });
    assert.equal(pubkey, PUBKEY);
  });

  it("returns null when no verified event exists", async () => {
    installLocalStorage();
    const spoof = spoofKind0Event({ id: "spoof", created_at: 200 });
    const pool = coveragePool([spoof]);
    setAppEventStorePoolForTest(pool as never);

    const pubkey = await attestedPubkeyForAddress(ADDRESS, { pool, nowSec: 1_000 });
    assert.equal(pubkey, null);
  });
});

describe("messaging intent discovery fail-closed", () => {
  it("returns unanswered when discovery cannot resolve a pubkey", async () => {
    installLocalStorage();
    clearCachedPubkey(ADDRESS);
    const pool = coveragePool([]);
    setAppEventStorePoolForTest(pool as never);

    const result = await readMessagingIntent(ADDRESS);
    assert.equal(result.status, "unanswered");
  });
});

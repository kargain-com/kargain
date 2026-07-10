import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { mergeNotificationStates } from "../lib/nostr/notification-state.ts";
import {
  migrateNostrIdentity,
  shouldSkipMigrationStep,
  unionFavoriteTokenIds,
} from "../lib/nostr/migrate-identity.ts";
import { nostrPubkeyFromPrivateKey } from "../lib/nostr/nostr-client.ts";
import type { NostrProfileData } from "../lib/nostr/parse-profile-content.ts";

const ADDRESS = "0xcfe194fea9727bD04dA8F78c2362680986e02dF1" as const;
const OLD_PUBKEY = "aa".repeat(32);
const NEW_PRIVATE_KEY = `0x${"11".repeat(32)}` as const;
const NEW_PUBKEY = nostrPubkeyFromPrivateKey(NEW_PRIVATE_KEY);

describe("unionFavoriteTokenIds", () => {
  it("preserves old order then appends new-only ids", () => {
    const merged = unionFavoriteTokenIds(["3", "1", "2"], ["2", "4", "1"]);
    assert.deepEqual(merged, ["3", "1", "2", "4"]);
  });

  it("deduplicates across lists", () => {
    const merged = unionFavoriteTokenIds(["10", "20"], ["20", "30"]);
    assert.deepEqual(merged, ["10", "20", "30"]);
  });

  it("handles empty inputs", () => {
    assert.deepEqual(unionFavoriteTokenIds([], []), []);
    assert.deepEqual(unionFavoriteTokenIds(["1"], []), ["1"]);
    assert.deepEqual(unionFavoriteTokenIds([], ["2"]), ["2"]);
  });
});

describe("shouldSkipMigrationStep", () => {
  it("is true when pubkeys match case-insensitively", () => {
    assert.equal(shouldSkipMigrationStep(OLD_PUBKEY, OLD_PUBKEY.toUpperCase()), true);
  });

  it("is false when pubkeys differ", () => {
    assert.equal(shouldSkipMigrationStep(OLD_PUBKEY, NEW_PUBKEY), false);
  });
});

describe("migrateNostrIdentity notification merge", () => {
  it("merges old and new notification state with max per channel", () => {
    const oldState = { lastSeenAt: { ponder: 100, nostr: 50, watchlist: 0 } };
    const newState = { lastSeenAt: { ponder: 200, nostr: 30, watchlist: 10 } };
    const merged = mergeNotificationStates(oldState, newState);
    assert.deepEqual(merged.lastSeenAt, { ponder: 200, nostr: 50, watchlist: 10 });
  });
});

describe("migrateNostrIdentity idempotency", () => {
  it("skip path when old and new pubkey are equal avoids relay writes", async () => {
    let saveFavoritesCalls = 0;
    let publishCalls = 0;
    let cacheWrites = 0;

    const result = await migrateNostrIdentity({
      address: ADDRESS,
      oldPubkey: NEW_PUBKEY,
      newPrivateKey: NEW_PRIVATE_KEY,
      signMessage: async () => `0x${"22".repeat(65)}` as const,
      deps: {
        loadFavorites: async () => {
          throw new Error("should not load favorites on skip");
        },
        saveFavorites: async () => {
          saveFavoritesCalls += 1;
        },
        loadNotificationState: async () => {
          throw new Error("should not load notification state on skip");
        },
        saveNotificationState: async () => {
          throw new Error("should not save notification state on skip");
        },
        fetchProfile: async () => {
          throw new Error("should not fetch profile on skip");
        },
        publishProfile: async () => {
          publishCalls += 1;
          return true;
        },
        savePubkeyCache: () => {
          cacheWrites += 1;
        },
      },
    });

    assert.equal(result.ok, true);
    assert.equal(saveFavoritesCalls, 0);
    assert.equal(publishCalls, 0);
    assert.equal(cacheWrites, 1);
  });

  it("re-run produces stable union without duplicate favorites", async () => {
    const savedFavorites: string[][] = [];
    let publishCalls = 0;

    const deps = {
      loadFavorites: async (pubkey: string) => {
        if (pubkey === OLD_PUBKEY) return ["100", "200"];
        return ["200", "300"];
      },
      saveFavorites: async (ids: string[]) => {
        savedFavorites.push([...ids]);
      },
      loadNotificationState: async (addr: `0x${string}`, pubkey: string) => {
        void addr;
        if (pubkey === OLD_PUBKEY) {
          return { lastSeenAt: { ponder: 10, nostr: 0, watchlist: 5 } };
        }
        return { lastSeenAt: { ponder: 0, nostr: 20, watchlist: 0 } };
      },
      saveNotificationState: async () => {},
      fetchProfile: async () => ({ name: "Migrated", about: "Bio" }),
      publishProfile: async (data: NostrProfileData) => {
        publishCalls += 1;
        assert.equal(data.name, "Migrated");
        return true;
      },
      savePubkeyCache: () => {},
    };

    const first = await migrateNostrIdentity({
      address: ADDRESS,
      oldPubkey: OLD_PUBKEY,
      newPrivateKey: NEW_PRIVATE_KEY,
      signMessage: async () => `0x${"22".repeat(65)}` as const,
      deps,
    });
    assert.equal(first.ok, true);
    assert.deepEqual(savedFavorites[0], ["100", "200", "300"]);
    assert.equal(publishCalls, 1);

    const second = await migrateNostrIdentity({
      address: ADDRESS,
      oldPubkey: OLD_PUBKEY,
      newPrivateKey: NEW_PRIVATE_KEY,
      signMessage: async () => `0x${"22".repeat(65)}` as const,
      deps: {
        ...deps,
        loadFavorites: async () => ["100", "200", "300"],
      },
    });
    assert.equal(second.ok, true);
    assert.deepEqual(savedFavorites[1], ["100", "200", "300"]);
    assert.equal(publishCalls, 2);
  });
});

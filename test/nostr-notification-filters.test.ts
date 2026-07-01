import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildNostrNotificationFilters,
  OWNED_LISTING_D_CHUNK_SIZE,
} from "../lib/notifications/nostr-notification-filters.ts";

const PUBKEY = "aa".repeat(32);
const SINCE = 1_700_000_000;

describe("buildNostrNotificationFilters", () => {
  it("always includes #p filters for kind 1 and 7", () => {
    const filters = buildNostrNotificationFilters(PUBKEY, [], SINCE);
    assert.equal(filters.length, 2);
    assert.deepEqual(filters[0], { kinds: [1], "#p": [PUBKEY], since: SINCE });
    assert.deepEqual(filters[1], { kinds: [7], "#p": [PUBKEY], since: SINCE });
  });

  it("skips #d filters when owned token list is empty", () => {
    const filters = buildNostrNotificationFilters(PUBKEY, [], SINCE);
    assert.equal(filters.some((f) => "#d" in f), false);
  });

  it("adds one #d filter for a single owned passport", () => {
    const filters = buildNostrNotificationFilters(PUBKEY, ["42"], SINCE);
    assert.equal(filters.length, 3);
    assert.deepEqual(filters[2], {
      kinds: [1],
      "#d": ["listing:42"],
      since: SINCE,
    });
  });

  it("chunks #d filters when owned passports exceed chunk size", () => {
    const owned = Array.from({ length: OWNED_LISTING_D_CHUNK_SIZE + 2 }, (_, i) => String(i + 1));
    const filters = buildNostrNotificationFilters(PUBKEY, owned, SINCE);

    const dFilters = filters.filter((f) => "#d" in f);
    assert.equal(dFilters.length, 2);
    assert.equal(dFilters[0]["#d"]?.length, OWNED_LISTING_D_CHUNK_SIZE);
    assert.equal(dFilters[1]["#d"]?.length, 2);
    assert.equal(dFilters[0]["#d"]?.[0], "listing:1");
    assert.equal(dFilters[1]["#d"]?.[1], "listing:10");
  });
});

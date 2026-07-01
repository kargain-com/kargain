import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Event } from "nostr-tools";
import { getAddress } from "viem";

import {
  LISTING_OFFER_KIND,
  parseListingOffersFromEvents,
} from "../lib/nostr/listing-offers.ts";

const BUYER_A = "aa".repeat(32);
const BUYER_B = "bb".repeat(32);
const SELLER_PUBKEY = "cc".repeat(32);
const TOKEN_ID = "84532-42";

function offerEvent(
  overrides: Partial<Event> & { pubkey: string },
): Event {
  const { pubkey, ...rest } = overrides;
  return {
    id: `id-${pubkey}-${rest.created_at ?? 100}`,
    pubkey,
    created_at: 1_700_000_000,
    kind: LISTING_OFFER_KIND,
    tags: [
      ["d", `kargain:offer:${TOKEN_ID}`],
      ["i", `kargain:passport:${TOKEN_ID}`],
      ["i", "ethereum:0xabcdefabcdefabcdefabcdefabcdefabcdefabcd"],
      ["p", SELLER_PUBKEY],
    ],
    content: "",
    sig: "sig",
    ...rest,
  };
}

describe("parseListingOffersFromEvents", () => {
  it("excludes buyer when latest event is withdrawn", () => {
    const events = [
      offerEvent({ pubkey: BUYER_A, created_at: 100, id: "a1" }),
      offerEvent({
        pubkey: BUYER_A,
        created_at: 200,
        content: "withdrawn",
        id: "a2",
      }),
    ];
    assert.deepEqual(parseListingOffersFromEvents(events), []);
  });

  it("keeps latest active event per pubkey", () => {
    const events = [
      offerEvent({
        pubkey: BUYER_A,
        created_at: 100,
        id: "a1",
        tags: [
          ["d", `kargain:offer:${TOKEN_ID}`],
          ["i", `kargain:passport:${TOKEN_ID}`],
          ["i", "ethereum:0x1111111111111111111111111111111111111111"],
          ["p", SELLER_PUBKEY],
        ],
      }),
      offerEvent({
        pubkey: BUYER_A,
        created_at: 300,
        id: "a2",
        tags: [
          ["d", `kargain:offer:${TOKEN_ID}`],
          ["i", `kargain:passport:${TOKEN_ID}`],
          ["i", "ethereum:0xabcdefabcdefabcdefabcdefabcdefabcdefabcd"],
          ["p", SELLER_PUBKEY],
        ],
      }),
    ];
    const result = parseListingOffersFromEvents(events);
    assert.equal(result.length, 1);
    assert.equal(
      result[0]?.buyerEthAddress,
      getAddress("0xabcdefabcdefabcdefabcdefabcdefabcdefabcd"),
    );
    assert.equal(result[0]?.timestamp, 300);
    assert.equal(result[0]?.eventId, "a2");
  });

  it("includes offers from different pubkeys", () => {
    const events = [
      offerEvent({ pubkey: BUYER_A, created_at: 100, id: "a1" }),
      offerEvent({ pubkey: BUYER_B, created_at: 150, id: "b1" }),
    ];
    const result = parseListingOffersFromEvents(events);
    assert.equal(result.length, 2);
  });

  it("skips events missing ethereum tag", () => {
    const events = [
      offerEvent({
        pubkey: BUYER_A,
        tags: [
          ["d", `kargain:offer:${TOKEN_ID}`],
          ["i", `kargain:passport:${TOKEN_ID}`],
          ["p", SELLER_PUBKEY],
        ],
      }),
    ];
    assert.deepEqual(parseListingOffersFromEvents(events), []);
  });

  it("sorts by timestamp descending", () => {
    const events = [
      offerEvent({ pubkey: BUYER_A, created_at: 100, id: "a1" }),
      offerEvent({ pubkey: BUYER_B, created_at: 500, id: "b1" }),
    ];
    const result = parseListingOffersFromEvents(events);
    assert.equal(result[0]?.timestamp, 500);
    assert.equal(result[1]?.timestamp, 100);
  });
});

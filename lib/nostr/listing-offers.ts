"use client";

import { getAddress, hexToBytes } from "viem";
import { finalizeEvent, type Event } from "nostr-tools";

import { getNostrPool, NOSTR_RELAYS } from "@/lib/nostr/nostr-client";
import { publishSignedEvent } from "@/lib/nostr/publish-event";

export const LISTING_OFFER_KIND = 30405;

const OFFER_D_PREFIX = "kargain:offer:";
const PASSPORT_TAG_PREFIX = "kargain:passport:";
const ETHEREUM_TAG_PREFIX = "ethereum:";

export type ListingOffer = {
  buyerEthAddress: `0x${string}`;
  timestamp: number;
  eventId: string;
};

function toPrivateKeyBytes(privateKey: string): Uint8Array {
  const hex = privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`;
  return hexToBytes(hex as `0x${string}`);
}

function offerDTag(tokenId: string): string {
  return `${OFFER_D_PREFIX}${tokenId}`;
}

function passportTag(tokenId: string): string {
  return `${PASSPORT_TAG_PREFIX}${tokenId}`;
}

function ethereumTag(address: string): string {
  return `${ETHEREUM_TAG_PREFIX}${address.toLowerCase()}`;
}

function extractEthereumAddress(tags: string[][]): `0x${string}` | null {
  for (const tag of tags) {
    if (tag[0] !== "i" || !tag[1]?.startsWith(ETHEREUM_TAG_PREFIX)) continue;
    const raw = tag[1].slice(ETHEREUM_TAG_PREFIX.length);
    if (!raw) continue;
    try {
      return getAddress(raw);
    } catch {
      continue;
    }
  }
  return null;
}

function buildOfferTags(
  tokenId: string,
  buyerEthAddress: string,
  sellerNostrPubkey: string,
): string[][] {
  return [
    ["d", offerDTag(tokenId)],
    ["i", passportTag(tokenId)],
    ["i", ethereumTag(buyerEthAddress)],
    ["p", sellerNostrPubkey],
  ];
}

/** Parse relay events into active offers (latest per pubkey, withdrawn filtered). */
export function parseListingOffersFromEvents(events: Event[]): ListingOffer[] {
  const latestByPubkey = new Map<string, Event>();

  for (const event of events) {
    if (event.kind !== LISTING_OFFER_KIND) continue;
    const existing = latestByPubkey.get(event.pubkey);
    if (!existing || event.created_at > existing.created_at) {
      latestByPubkey.set(event.pubkey, event);
    }
  }

  const offers: ListingOffer[] = [];

  for (const event of latestByPubkey.values()) {
    if (event.content === "withdrawn") continue;
    const buyerEthAddress = extractEthereumAddress(event.tags);
    if (!buyerEthAddress) continue;
    offers.push({
      buyerEthAddress,
      timestamp: event.created_at,
      eventId: event.id,
    });
  }

  offers.sort((a, b) => b.timestamp - a.timestamp);
  return offers;
}

/** Publish or update an offer for a listing. Throws on relay failure. */
export async function publishListingOffer(
  tokenId: string,
  buyerEthAddress: `0x${string}`,
  sellerNostrPubkey: string,
  privateKey: string,
): Promise<void> {
  const tags = buildOfferTags(tokenId, buyerEthAddress, sellerNostrPubkey);
  const unsigned = {
    kind: LISTING_OFFER_KIND,
    created_at: Math.floor(Date.now() / 1000),
    content: "",
    tags,
  };
  const signed = finalizeEvent(unsigned, toPrivateKeyBytes(privateKey));
  const pool = getNostrPool();
  const { ok } = await publishSignedEvent(pool, signed);
  if (!ok) throw new Error("relay publish failed");
}

/** Withdraw an offer by re-publishing with content "withdrawn". Throws on relay failure. */
export async function withdrawListingOffer(
  tokenId: string,
  buyerEthAddress: `0x${string}`,
  sellerNostrPubkey: string,
  privateKey: string,
): Promise<void> {
  const tags = buildOfferTags(tokenId, buyerEthAddress, sellerNostrPubkey);
  const unsigned = {
    kind: LISTING_OFFER_KIND,
    created_at: Math.floor(Date.now() / 1000),
    content: "withdrawn",
    tags,
  };
  const signed = finalizeEvent(unsigned, toPrivateKeyBytes(privateKey));
  const pool = getNostrPool();
  const { ok } = await publishSignedEvent(pool, signed);
  if (!ok) throw new Error("relay publish failed");
}

/** Query all active offers for a listing. Never throws. */
export async function fetchListingOffers(
  tokenId: string,
  sellerNostrPubkey: string,
): Promise<ListingOffer[]> {
  try {
    if (!tokenId.trim() || !sellerNostrPubkey.trim()) return [];
    const pool = getNostrPool();
    const events = await pool.querySync(
      [...NOSTR_RELAYS],
      {
        kinds: [LISTING_OFFER_KIND],
        "#i": [passportTag(tokenId)],
        "#p": [sellerNostrPubkey],
        limit: 500,
      },
      { maxWait: 4500 },
    );
    return parseListingOffersFromEvents(events);
  } catch (err) {
    console.error("fetchListingOffers failed", err);
    return [];
  }
}

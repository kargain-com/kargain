"use server";

import type { PonderFeedItem } from "@/lib/notifications/types";
import { ponderBaseUrl, ponderFetch } from "@/lib/web3/ponder-fetch";

export type NotificationsFeedResult = {
  items: PonderFeedItem[];
  ponderError?: string;
};

export type PonderPassportBatchRow = {
  id: string;
  status: string;
  updatedAt: string | number;
};

export type PonderListingBatchRow = {
  tokenId: string;
  active: boolean;
  fiatPrice1e8: string | number;
};

export type PassportBatchResult = {
  passports: PonderPassportBatchRow[];
  ponderError?: string;
};

export type ListingBatchResult = {
  listings: PonderListingBatchRow[];
  ponderError?: string;
};

type PonderNotificationsResponse = {
  items: PonderFeedItem[];
};

type PonderPassportBatchResponse = {
  passports: PonderPassportBatchRow[];
};

type PonderListingBatchResponse = {
  listings: Array<PonderListingBatchRow & { id?: string }>;
};

type PonderProfilePassportsResponse = {
  passports: Array<{ id?: string | number }>;
};

export async function fetchOwnedPassportTokenIds(address: string): Promise<string[]> {
  try {
    const res = await ponderFetch(`${ponderBaseUrl()}/profile/${encodeURIComponent(address)}/passports`);
    if (!res.ok) return [];

    const data = (await res.json()) as PonderProfilePassportsResponse;
    return (data.passports ?? [])
      .map((p) => String(p.id ?? "").trim())
      .filter((id) => id.length > 0);
  } catch {
    return [];
  }
}

export async function fetchNotificationFeed(
  address: string,
  since: number,
): Promise<NotificationsFeedResult> {
  try {
    const url = new URL(`${ponderBaseUrl()}/notifications/${encodeURIComponent(address)}`);
    url.searchParams.set("since", String(since));
    url.searchParams.set("limit", "50");

    const res = await ponderFetch(url.toString());
    if (!res.ok) {
      return { items: [], ponderError: "PONDER_UNAVAILABLE" };
    }

    const data = (await res.json()) as PonderNotificationsResponse;
    return { items: data.items ?? [] };
  } catch {
    return { items: [], ponderError: "PONDER_UNAVAILABLE" };
  }
}

export async function fetchPassportBatch(tokenIds: string[]): Promise<PassportBatchResult> {
  if (tokenIds.length === 0) return { passports: [] };
  try {
    const url = new URL(`${ponderBaseUrl()}/passports/batch`);
    url.searchParams.set("ids", tokenIds.join(","));
    const res = await ponderFetch(url.toString());
    if (!res.ok) {
      return { passports: [], ponderError: "PONDER_UNAVAILABLE" };
    }
    const data = (await res.json()) as PonderPassportBatchResponse;
    return { passports: data.passports ?? [] };
  } catch {
    return { passports: [], ponderError: "PONDER_UNAVAILABLE" };
  }
}

export async function fetchListingBatch(tokenIds: string[]): Promise<ListingBatchResult> {
  if (tokenIds.length === 0) return { listings: [] };
  try {
    const url = new URL(`${ponderBaseUrl()}/listings/batch`);
    url.searchParams.set("ids", tokenIds.join(","));
    const res = await ponderFetch(url.toString());
    if (!res.ok) {
      return { listings: [], ponderError: "PONDER_UNAVAILABLE" };
    }
    const data = (await res.json()) as PonderListingBatchResponse;
    const listings = (data.listings ?? []).map((row) => ({
      tokenId: row.tokenId ?? row.id ?? "",
      active: row.active,
      fiatPrice1e8: row.fiatPrice1e8,
    }));
    return { listings };
  } catch {
    return { listings: [], ponderError: "PONDER_UNAVAILABLE" };
  }
}

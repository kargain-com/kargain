"use server";

import type { PonderFeedItem } from "@/lib/notifications/types";

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

const PONDER_URL = process.env.PONDER_SQL_API_URL ?? "http://localhost:42069";

type PonderNotificationsResponse = {
  items: PonderFeedItem[];
};

type PonderPassportBatchResponse = {
  passports: PonderPassportBatchRow[];
};

type PonderListingBatchResponse = {
  listings: Array<PonderListingBatchRow & { id?: string }>;
};

export async function fetchNotificationFeed(
  address: string,
  since: number,
): Promise<NotificationsFeedResult> {
  try {
    const url = new URL(`${PONDER_URL}/notifications/${encodeURIComponent(address)}`);
    url.searchParams.set("since", String(since));
    url.searchParams.set("limit", "50");

    const res = await fetch(url.toString(), { next: { revalidate: 30 } });
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
    const url = new URL(`${PONDER_URL}/passports/batch`);
    url.searchParams.set("ids", tokenIds.join(","));
    const res = await fetch(url.toString(), { next: { revalidate: 30 } });
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
    const url = new URL(`${PONDER_URL}/listings/batch`);
    url.searchParams.set("ids", tokenIds.join(","));
    const res = await fetch(url.toString(), { next: { revalidate: 30 } });
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

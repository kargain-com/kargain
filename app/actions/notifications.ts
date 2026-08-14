"use server";

import type { PonderFeedItem } from "@/lib/notifications/types";
import { consignmentToListingInput } from "@/lib/commerce/listing-view";
import {
  buildPonderUrl,
  fetchConsignmentByToken,
  ponderFetch,
} from "@/lib/web3/ponder-fetch";

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
  price?: string | number;
  denominationKind?: number;
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

type PonderProfilePassportsResponse = {
  passports: Array<{ id?: string | number }>;
};

export async function fetchOwnedPassportTokenIds(address: string): Promise<string[]> {
  try {
    const res = await ponderFetch(
      buildPonderUrl("profile.passports", { address }).toString(),
    );
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
    const url = buildPonderUrl(
      "notifications.feed",
      { address },
      { since, limit: 50 },
    );
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
    const url = buildPonderUrl("passports.batch", {}, { ids: tokenIds.join(",") });
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

/**
 * Watchlist listing snapshots — `/listings/batch` is not registered.
 * Resolve each token via `consignments/by-token` (fixedPrice).
 */
export async function fetchListingBatch(tokenIds: string[]): Promise<ListingBatchResult> {
  if (tokenIds.length === 0) return { listings: [] };
  try {
    const listings = await Promise.all(
      tokenIds.map(async (tokenId) => {
        const lot = await fetchConsignmentByToken(tokenId, { mode: "fixedPrice" });
        if (!lot.ok || lot.consignment == null) {
          return {
            tokenId,
            active: false,
            fiatPrice1e8: "0",
          } satisfies PonderListingBatchRow;
        }
        const row = lot.consignment;
        const input = consignmentToListingInput(row);
        return {
          tokenId,
          active: input.active,
          price: input.price,
          denominationKind: input.denominationKind,
          fiatPrice1e8: input.fiatPrice1e8,
        } satisfies PonderListingBatchRow;
      }),
    );
    return { listings };
  } catch {
    return { listings: [], ponderError: "PONDER_UNAVAILABLE" };
  }
}

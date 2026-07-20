"use server";

import {
  filterBidsForAuction,
  mapPonderAuctionBid,
  mapPonderAuctionRow,
  type AuctionBid,
  type AuctionRow,
  type PonderAuctionBidRaw,
  type PonderAuctionRaw,
} from "@/lib/auction/map-ponder-auction";
import { DEFAULT_CHAIN_ID } from "@/lib/web3/supported-chains";

const PONDER_URL =
  process.env.PONDER_SQL_API_URL ?? "http://localhost:42069";

export type AuctionDetailResult =
  | { ok: true; auction: AuctionRow | null; ponderError?: string }
  | { ok: false; error: "PONDER_UNAVAILABLE" };

export type AuctionBidsResult = {
  ok: true;
  bids: AuctionBid[];
  total: number;
  page: number;
  totalPages: number;
  ponderError?: string;
};

type PonderBidsResponse = {
  bids: PonderAuctionBidRaw[];
  total: number;
  page: number;
  limit: number;
};

export async function getAuctionDetail(
  tokenId: string,
  chainId: number = DEFAULT_CHAIN_ID,
): Promise<AuctionDetailResult> {
  try {
    const res = await fetch(`${PONDER_URL}/auctions/${tokenId}`, {
      cache: "no-store",
    });
    if (res.status === 404) {
      return { ok: true, auction: null };
    }
    if (!res.ok) {
      return { ok: true, auction: null, ponderError: "PONDER_UNAVAILABLE" };
    }
    const raw = (await res.json()) as PonderAuctionRaw;
    if (!raw?.tokenId) {
      return { ok: true, auction: null };
    }
    return { ok: true, auction: mapPonderAuctionRow(raw, chainId) };
  } catch {
    return { ok: false, error: "PONDER_UNAVAILABLE" };
  }
}

export async function getAuctionBids(
  tokenId: string,
  opts?: {
    page?: number;
    limit?: number;
    /** U11 — filter bids older than this auction's createdAt. */
    auctionCreatedAt?: bigint | string | number;
  },
): Promise<AuctionBidsResult> {
  const page = opts?.page ?? 1;
  const limit = opts?.limit ?? 50;

  try {
    const url = new URL(`${PONDER_URL}/auctions/${tokenId}/bids`);
    url.searchParams.set("page", String(page));
    url.searchParams.set("limit", String(limit));

    const res = await fetch(url.toString(), {
      cache: "no-store",
    });
    if (!res.ok) {
      return {
        ok: true,
        bids: [],
        total: 0,
        page,
        totalPages: 0,
        ponderError: "PONDER_UNAVAILABLE",
      };
    }

    const data = (await res.json()) as PonderBidsResponse;
    let bids = (data.bids ?? []).map(mapPonderAuctionBid);

    if (opts?.auctionCreatedAt != null) {
      const createdAt =
        typeof opts.auctionCreatedAt === "bigint"
          ? opts.auctionCreatedAt
          : BigInt(opts.auctionCreatedAt);
      bids = filterBidsForAuction(bids, createdAt);
    }

    const total = data.total ?? bids.length;
    const totalPages = Math.max(1, Math.ceil(total / (data.limit || limit)));

    return {
      ok: true,
      bids,
      total,
      page: data.page ?? page,
      totalPages,
    };
  } catch {
    return {
      ok: true,
      bids: [],
      total: 0,
      page,
      totalPages: 0,
      ponderError: "PONDER_UNAVAILABLE",
    };
  }
}

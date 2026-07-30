"use server";

import {
  filterBidsForAuction,
  mapPonderAuctionRow,
  type AuctionBid,
  type AuctionRow,
} from "@/lib/auction/map-ponder-auction";
import { consignmentToAuctionRaw } from "@/lib/commerce/auction-view";
import {
  mapConsignmentBidRows,
  type PonderConsignmentBidRow,
  type PonderConsignmentRow,
} from "@/lib/commerce/ponder-consignment";
import { ponderBaseUrl, ponderFetch } from "@/lib/web3/ponder-fetch";

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

type BidsResponse = {
  bids?: PonderConsignmentBidRow[];
  total?: number;
  page?: number;
  limit?: number;
};

export async function getAuctionDetail(
  tokenId: string,
): Promise<AuctionDetailResult> {
  try {
    const url = new URL(`${ponderBaseUrl()}/consignments/${tokenId}`);
    url.searchParams.set("mode", "ascending");

    const res = await ponderFetch(url.toString());
    if (res.status === 404) {
      return { ok: true, auction: null };
    }
    if (!res.ok) {
      return { ok: true, auction: null, ponderError: "PONDER_UNAVAILABLE" };
    }
    const raw = (await res.json()) as PonderConsignmentRow;
    if (!raw?.tokenId) {
      return { ok: true, auction: null };
    }
    return { ok: true, auction: mapPonderAuctionRow(consignmentToAuctionRaw(raw)) };
  } catch {
    return { ok: false, error: "PONDER_UNAVAILABLE" };
  }
}

export async function getAuctionBids(
  tokenId: string,
  opts?: {
    page?: number;
    limit?: number;
    /** Drop bids from prior lots on the same passport. */
    auctionCreatedAt?: bigint | string | number;
  },
): Promise<AuctionBidsResult> {
  const page = opts?.page ?? 1;
  const limit = opts?.limit ?? 50;

  try {
    const url = new URL(`${ponderBaseUrl()}/consignments/${tokenId}/bids`);
    url.searchParams.set("page", String(page));
    url.searchParams.set("limit", String(limit));

    const res = await ponderFetch(url.toString());
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

    const data = (await res.json()) as BidsResponse;
    let bids: AuctionBid[] = mapConsignmentBidRows(data.bids).map((bid) => ({
      id: bid.id,
      tokenId: bid.tokenId,
      bidder: bid.bidder,
      amount: bid.amount,
      endsAt: bid.endsAt,
      refunded: bid.refunded,
      timestamp: BigInt(bid.timestamp),
    }));

    if (opts?.auctionCreatedAt != null) {
      const createdAt =
        typeof opts.auctionCreatedAt === "bigint"
          ? opts.auctionCreatedAt
          : BigInt(opts.auctionCreatedAt);
      bids = filterBidsForAuction(bids, createdAt);
    }

    const total = data.total ?? bids.length;

    return {
      ok: true,
      bids,
      total,
      page: data.page ?? page,
      totalPages: Math.max(1, Math.ceil(total / (data.limit || limit))),
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

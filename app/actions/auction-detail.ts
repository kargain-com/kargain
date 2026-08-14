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
} from "@/lib/commerce/ponder-consignment";
import {
  fetchBidsForPassportToken,
  fetchConsignmentByToken,
} from "@/lib/web3/ponder-fetch";

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
    const lot = await fetchConsignmentByToken(tokenId, { mode: "ascending" });
    if (!lot.ok) {
      return { ok: true, auction: null, ponderError: "PONDER_UNAVAILABLE" };
    }
    if (lot.consignment == null) {
      return { ok: true, auction: null };
    }
    if (!lot.consignment.tokenId) {
      return { ok: true, auction: null };
    }
    return {
      ok: true,
      auction: mapPonderAuctionRow(consignmentToAuctionRaw(lot.consignment)),
    };
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
    const result = await fetchBidsForPassportToken(tokenId, {
      mode: "ascending",
      page,
      limit,
    });
    if (!result.ok) {
      return {
        ok: true,
        bids: [],
        total: 0,
        page,
        totalPages: 0,
        ponderError: "PONDER_UNAVAILABLE",
      };
    }
    if (result.body == null) {
      return { ok: true, bids: [], total: 0, page, totalPages: 0 };
    }

    const data = result.body as BidsResponse;
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

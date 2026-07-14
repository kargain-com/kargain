"use server";

import {
  mapPonderAuctionRow,
  partitionActiveAuctions,
  type AuctionRow,
  type PonderAuctionRaw,
} from "@/lib/auction/map-ponder-auction";
import { DEFAULT_CHAIN_ID } from "@/lib/web3/supported-chains";

const PONDER_URL =
  process.env.PONDER_SQL_API_URL ?? "http://localhost:42069";

export type AuctionBrowseResult = {
  ok: true;
  rows: AuctionRow[];
  total: number;
  page: number;
  totalPages: number;
  ponderError?: string;
};

type PonderAuctionsResponse = {
  auctions: PonderAuctionRaw[];
  total: number;
  page: number;
  limit: number;
};

export async function searchActiveAuctions(opts?: {
  page?: number;
  limit?: number;
  chainId?: number;
}): Promise<AuctionBrowseResult> {
  const page = opts?.page ?? 1;
  const limit = opts?.limit ?? 48;
  const chainId = opts?.chainId ?? DEFAULT_CHAIN_ID;

  try {
    const url = new URL(`${PONDER_URL}/auctions`);
    url.searchParams.set("active", "true");
    url.searchParams.set("page", String(page));
    url.searchParams.set("limit", String(limit));

    const res = await fetch(url.toString(), {
      next: { revalidate: 15 },
    });
    if (!res.ok) {
      return {
        ok: true,
        rows: [],
        total: 0,
        page,
        totalPages: 0,
        ponderError: "PONDER_UNAVAILABLE",
      };
    }

    const data = (await res.json()) as PonderAuctionsResponse;
    const mapped = (data.auctions ?? []).map((row) =>
      mapPonderAuctionRow(row, chainId),
    );
    const rows = partitionActiveAuctions(mapped);
    const total = data.total ?? rows.length;
    const totalPages = Math.max(1, Math.ceil(total / (data.limit || limit)));

    return {
      ok: true,
      rows,
      total,
      page: data.page ?? page,
      totalPages,
    };
  } catch {
    return {
      ok: true,
      rows: [],
      total: 0,
      page,
      totalPages: 0,
      ponderError: "PONDER_UNAVAILABLE",
    };
  }
}

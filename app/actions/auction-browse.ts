"use server";

import {
  mapPonderAuctionRow,
  partitionActiveAuctions,
  type AuctionRow,
  type PonderAuctionRaw,
} from "@/lib/auction/map-ponder-auction";

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

/** Lightweight active-auction total for homepage stats — no row mapping. */
export async function fetchActiveAuctionCount(): Promise<number> {
  try {
    const url = new URL(`${PONDER_URL}/auctions`);
    url.searchParams.set("active", "true");
    url.searchParams.set("page", "1");
    url.searchParams.set("limit", "1");

    const res = await fetch(url.toString(), {
      cache: "no-store",
    });
    if (!res.ok) return 0;

    const data = (await res.json()) as Pick<PonderAuctionsResponse, "total">;
    const total = data.total;
    return typeof total === "number" && Number.isFinite(total) && total > 0
      ? Math.floor(total)
      : 0;
  } catch {
    return 0;
  }
}

export async function searchActiveAuctions(opts?: {
  page?: number;
  limit?: number;
  /** Retained for callers; mapped rows use Ponder auction.chainId. */
  chainId?: number;
}): Promise<AuctionBrowseResult> {
  const page = opts?.page ?? 1;
  const limit = opts?.limit ?? 48;
  void opts?.chainId;

  try {
    const url = new URL(`${PONDER_URL}/auctions`);
    url.searchParams.set("active", "true");
    url.searchParams.set("page", String(page));
    url.searchParams.set("limit", String(limit));

    const res = await fetch(url.toString(), {
      cache: "no-store",
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
    const mapped = (data.auctions ?? []).map((row) => mapPonderAuctionRow(row));
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

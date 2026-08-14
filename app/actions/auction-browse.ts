"use server";

import {
  mapPonderAuctionRow,
  partitionActiveAuctions,
  type AuctionRow,
} from "@/lib/auction/map-ponder-auction";
import { consignmentToAuctionRaw } from "@/lib/commerce/auction-view";
import type { PonderConsignmentRow } from "@/lib/commerce/ponder-consignment";
import { buildConsignmentsListUrl, ponderFetch } from "@/lib/web3/ponder-fetch";

export type AuctionBrowseResult = {
  ok: true;
  rows: AuctionRow[];
  total: number;
  page: number;
  totalPages: number;
  ponderError?: string;
};

type ConsignmentsResponse = {
  consignments?: PonderConsignmentRow[];
  total?: number;
  page?: number;
  limit?: number;
};

function ascendingUrl(page: number, limit: number): URL {
  return buildConsignmentsListUrl({
    mode: "ascending",
    active: true,
    page,
    limit,
  });
}

/** Live ascending-lot total for homepage stats — no row mapping. */
export async function fetchActiveAuctionCount(): Promise<number> {
  try {
    const res = await ponderFetch("ascending-browse", ascendingUrl(1, 1).toString());
    if (!res.ok) return 0;

    const data = res.body as ConsignmentsResponse;
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
  /** Retained for callers; mapped rows use the indexed consignment chainId. */
  chainId?: number;
}): Promise<AuctionBrowseResult> {
  const page = opts?.page ?? 1;
  const limit = opts?.limit ?? 48;
  void opts?.chainId;

  try {
    const res = await ponderFetch("ascending-browse", ascendingUrl(page, limit).toString());
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

    const data = res.body as ConsignmentsResponse;
    const mapped = (data.consignments ?? []).map((row) =>
      mapPonderAuctionRow(consignmentToAuctionRaw(row)),
    );
    const rows = partitionActiveAuctions(mapped);
    const total = data.total ?? rows.length;

    return {
      ok: true,
      rows,
      total,
      page: data.page ?? page,
      totalPages: Math.max(1, Math.ceil(total / (data.limit || limit))),
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

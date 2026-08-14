"use server";

import {
  mapConsignmentBidRows,
  mapConsignmentRow,
  mapConsignmentRows,
  type ConsignmentBidRecord,
  type ConsignmentRecord,
  type PonderConsignmentBidRow,
  type PonderConsignmentRow,
} from "@/lib/commerce/ponder-consignment";
import type { CommerceMode } from "@/lib/commerce/mode";
import {
  buildConsignmentsListUrl,
  fetchBidsForPassportToken,
  fetchConsignmentBids,
  fetchConsignmentByToken,
  ponderFetch,
} from "@/lib/web3/ponder-fetch";

export type ConsignmentsPage = {
  ok: true;
  rows: ConsignmentRecord[];
  total: number;
  page: number;
  totalPages: number;
  ponderError?: "PONDER_UNAVAILABLE";
};

export type ConsignmentDetailResult = {
  ok: true;
  consignment: ConsignmentRecord | null;
  ponderError?: "PONDER_UNAVAILABLE";
};

export type ConsignmentBidsResult = {
  ok: true;
  bids: ConsignmentBidRecord[];
  total: number;
  page: number;
  totalPages: number;
  ponderError?: "PONDER_UNAVAILABLE";
};

type ConsignmentsResponse = {
  consignments?: PonderConsignmentRow[];
  total?: number;
  page?: number;
  limit?: number;
  statusCounts?: {
    UNVERIFIED?: number;
    VERIFIED?: number;
    DISPUTED?: number;
  };
};

type BidsResponse = {
  bids?: PonderConsignmentBidRow[];
  total?: number;
  page?: number;
  limit?: number;
};

export type ConsignmentQuery = {
  mode?: CommerceMode;
  /** Convenience: offered + binding only (`active=true` on the HTTP API). */
  live?: boolean;
  /** Exact indexed phase (`phase=` on the HTTP API). */
  phase?: string;
  chainId?: number;
  seller?: string;
  agent?: string;
  page?: number;
  limit?: number;
};

function emptyPage(page: number): ConsignmentsPage {
  return {
    ok: true,
    rows: [],
    total: 0,
    page,
    totalPages: 0,
    ponderError: "PONDER_UNAVAILABLE",
  };
}

export async function getConsignments(
  query: ConsignmentQuery = {},
): Promise<ConsignmentsPage> {
  const page = query.page ?? 1;
  const limit = query.limit ?? 48;

  try {
    const url = buildConsignmentsListUrl({
      page,
      limit,
      mode: query.mode,
      active:
        query.live === true ? true : query.live === false ? false : undefined,
      phase: query.phase,
      chainId: query.chainId,
      seller: query.seller,
      agent: query.agent,
    });
    const res = await ponderFetch("consignments", url.toString());
    if (!res.ok) return emptyPage(page);

    const data = res.body as ConsignmentsResponse;
    const rows = mapConsignmentRows(data.consignments);
    const total = data.total ?? rows.length;

    return {
      ok: true,
      rows,
      total,
      page: data.page ?? page,
      totalPages: Math.max(1, Math.ceil(total / (data.limit || limit))),
    };
  } catch {
    return emptyPage(page);
  }
}

/** Live-lot ambient stats — totals from browse envelope (`limit=1`). */
export async function fetchLiveConsignmentBrowseStats(mode?: CommerceMode): Promise<{
  total: number;
  verified: number;
}> {
  try {
    const res = await ponderFetch(
      "consignments",
      buildConsignmentsListUrl({
        mode,
        active: true,
        page: 1,
        limit: 1,
      }).toString(),
    );
    if (!res.ok) return { total: 0, verified: 0 };
    const data = res.body as ConsignmentsResponse;
    const total = data.total;
    const verified = data.statusCounts?.VERIFIED;
    return {
      total:
        typeof total === "number" && Number.isFinite(total) && total > 0
          ? Math.floor(total)
          : 0,
      verified:
        typeof verified === "number" && Number.isFinite(verified) && verified > 0
          ? Math.floor(verified)
          : 0,
    };
  } catch {
    return { total: 0, verified: 0 };
  }
}

/** Live-lot count for ambient stats — `0` when the indexer is unreachable. */
export async function fetchLiveConsignmentCount(
  mode?: CommerceMode,
): Promise<number> {
  const stats = await fetchLiveConsignmentBrowseStats(mode);
  return stats.total;
}

export async function getConsignmentDetail(
  tokenId: string,
  mode: CommerceMode,
): Promise<ConsignmentDetailResult> {
  try {
    const lot = await fetchConsignmentByToken(tokenId, { mode });
    if (!lot.ok) {
      return { ok: true, consignment: null, ponderError: "PONDER_UNAVAILABLE" };
    }
    if (lot.consignment == null) return { ok: true, consignment: null };
    return {
      ok: true,
      consignment: mapConsignmentRow(lot.consignment),
    };
  } catch {
    return { ok: true, consignment: null, ponderError: "PONDER_UNAVAILABLE" };
  }
}

export async function getConsignmentBids(
  tokenId: string,
  opts?: { page?: number; limit?: number; consignmentId?: string },
): Promise<ConsignmentBidsResult> {
  const page = opts?.page ?? 1;
  const limit = opts?.limit ?? 50;

  try {
    if (opts?.consignmentId) {
      const res = await fetchConsignmentBids(opts.consignmentId, { page, limit });
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
      const data = res.body as BidsResponse;
      const bids = mapConsignmentBidRows(data.bids);
      const total = data.total ?? bids.length;
      return {
        ok: true,
        bids,
        total,
        page: data.page ?? page,
        totalPages: Math.max(1, Math.ceil(total / (data.limit || limit))),
      };
    }

    const result = await fetchBidsForPassportToken(tokenId, { page, limit });
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
    const bids = mapConsignmentBidRows(data.bids);
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

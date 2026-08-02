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
import { ponderBaseUrl, ponderFetch } from "@/lib/web3/ponder-fetch";

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

function consignmentsUrl(query: ConsignmentQuery): URL {
  const url = new URL(`${ponderBaseUrl()}/consignments`);
  const { page = 1, limit = 48 } = query;
  url.searchParams.set("page", String(page));
  url.searchParams.set("limit", String(limit));
  if (query.mode) url.searchParams.set("mode", query.mode);
  // API filter is `active` → OPEN_PHASES (offered|binding). `live` is the
  // product name in this action; do not send a phantom `live` query key.
  if (query.live === true) url.searchParams.set("active", "true");
  else if (query.live === false) url.searchParams.set("active", "false");
  if (query.phase) url.searchParams.set("phase", query.phase);
  if (query.chainId != null) url.searchParams.set("chainId", String(query.chainId));
  if (query.seller) url.searchParams.set("seller", query.seller);
  if (query.agent) url.searchParams.set("agent", query.agent);
  return url;
}

export async function getConsignments(
  query: ConsignmentQuery = {},
): Promise<ConsignmentsPage> {
  const page = query.page ?? 1;
  const limit = query.limit ?? 48;

  try {
    const res = await ponderFetch(consignmentsUrl(query).toString());
    if (!res.ok) return emptyPage(page);

    const data = (await res.json()) as ConsignmentsResponse;
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

/** Live-lot count for ambient stats — `0` when the indexer is unreachable. */
export async function fetchLiveConsignmentCount(
  mode?: CommerceMode,
): Promise<number> {
  try {
    const res = await ponderFetch(
      consignmentsUrl({ mode, live: true, page: 1, limit: 1 }).toString(),
    );
    if (!res.ok) return 0;
    const data = (await res.json()) as ConsignmentsResponse;
    const total = data.total;
    return typeof total === "number" && Number.isFinite(total) && total > 0
      ? Math.floor(total)
      : 0;
  } catch {
    return 0;
  }
}

export async function getConsignmentDetail(
  tokenId: string,
  mode: CommerceMode,
): Promise<ConsignmentDetailResult> {
  try {
    const url = new URL(`${ponderBaseUrl()}/consignments/${tokenId}`);
    url.searchParams.set("mode", mode);

    const res = await ponderFetch(url.toString());
    if (res.status === 404) return { ok: true, consignment: null };
    if (!res.ok) {
      return { ok: true, consignment: null, ponderError: "PONDER_UNAVAILABLE" };
    }

    const raw = (await res.json()) as PonderConsignmentRow;
    return { ok: true, consignment: mapConsignmentRow(raw) };
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
    const url = new URL(`${ponderBaseUrl()}/consignments/${tokenId}/bids`);
    url.searchParams.set("page", String(page));
    url.searchParams.set("limit", String(limit));
    if (opts?.consignmentId) {
      url.searchParams.set("consignmentId", opts.consignmentId);
    }

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

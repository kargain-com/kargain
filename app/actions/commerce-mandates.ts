"use server";

import type { CommerceMode } from "@/lib/commerce/mode";
import {
  mapMandateRows,
  type MandateRecord,
  type PonderMandateRow,
} from "@/lib/commerce/ponder-consignment";
import { ponderBaseUrl, ponderFetch } from "@/lib/web3/ponder-fetch";

export type MandatesPage = {
  ok: true;
  rows: MandateRecord[];
  total: number;
  page: number;
  totalPages: number;
  ponderError?: "PONDER_UNAVAILABLE";
};

type MandatesResponse = {
  mandates?: PonderMandateRow[];
  total?: number;
  page?: number;
  limit?: number;
};

export type MandateQuery = {
  mode?: CommerceMode;
  /** Standing grants only — omit to include revoked history. */
  active?: boolean;
  /** Grants with no live consignment yet (agent "awaiting" queue). */
  hasLiveConsignment?: boolean;
  page?: number;
  limit?: number;
};

function emptyPage(page: number): MandatesPage {
  return {
    ok: true,
    rows: [],
    total: 0,
    page,
    totalPages: 0,
    ponderError: "PONDER_UNAVAILABLE",
  };
}

async function fetchMandates(
  path: string,
  query: MandateQuery,
): Promise<MandatesPage> {
  const page = query.page ?? 1;
  const limit = query.limit ?? 24;

  try {
    const url = new URL(`${ponderBaseUrl()}${path}`);
    url.searchParams.set("page", String(page));
    url.searchParams.set("limit", String(limit));
    if (query.mode) url.searchParams.set("mode", query.mode);
    if (query.active != null) url.searchParams.set("active", String(query.active));
    if (query.hasLiveConsignment != null) {
      url.searchParams.set("hasLiveConsignment", String(query.hasLiveConsignment));
    }

    const res = await ponderFetch(url.toString());
    if (!res.ok) return emptyPage(page);

    const data = (await res.json()) as MandatesResponse;
    const rows = mapMandateRows(data.mandates);
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

/** Grants held by an agent (KarPro consignment inbox). */
export async function getAgentMandates(
  address: string,
  query: MandateQuery = {},
): Promise<MandatesPage> {
  return fetchMandates(`/agents/${address}/mandates`, query);
}

/** Grants issued by an owner (delegated vehicles). */
export async function getOwnerMandates(
  address: string,
  query: MandateQuery = {},
): Promise<MandatesPage> {
  return fetchMandates(`/owners/${address}/mandates`, query);
}

/** Active grant count for a profile tab badge — `0` when unreachable. */
export async function getAgentMandateCount(address: string): Promise<number> {
  const result = await getAgentMandates(address, {
    active: true,
    page: 1,
    limit: 1,
  });
  return result.ponderError ? 0 : result.total;
}

/** Active owner grant count for the delegated tab badge — `0` when unreachable. */
export async function getOwnerMandateCount(address: string): Promise<number> {
  const result = await getOwnerMandates(address, {
    active: true,
    page: 1,
    limit: 1,
  });
  return result.ponderError ? 0 : result.total;
}

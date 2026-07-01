"use server";

import { getAddress } from "viem";

import type {
  PonderAgentAuthorizationsResponse,
  PonderAgentListingsResponse,
} from "@/lib/types/ponder";

const PONDER_URL =
  process.env.PONDER_SQL_API_URL ?? "http://localhost:42069";

const EMPTY_AUTHORIZATIONS: PonderAgentAuthorizationsResponse = {
  authorizations: [],
  total: 0,
  page: 1,
  limit: 20,
};

const EMPTY_LISTINGS: PonderAgentListingsResponse = {
  listings: [],
  total: 0,
  page: 1,
  limit: 20,
};

function parseAgentAddress(address: string): `0x${string}` | null {
  try {
    return getAddress(address);
  } catch {
    return null;
  }
}

export async function getAgentAuthorizations(
  address: string,
  page = 1,
  limit = 20,
  hasActiveListing?: boolean,
): Promise<PonderAgentAuthorizationsResponse & { ponderError?: string }> {
  const agent = parseAgentAddress(address);
  if (!agent) return { ...EMPTY_AUTHORIZATIONS, page, limit };

  try {
    const url = new URL(`${PONDER_URL}/agents/${agent}/authorizations`);
    url.searchParams.set("page", String(page));
    url.searchParams.set("limit", String(limit));
    if (hasActiveListing === false) {
      url.searchParams.set("hasActiveListing", "false");
    } else if (hasActiveListing === true) {
      url.searchParams.set("hasActiveListing", "true");
    }
    const res = await fetch(url.toString(), { next: { revalidate: 30 } });
    if (!res.ok) {
      return { ...EMPTY_AUTHORIZATIONS, page, limit, ponderError: "PONDER_UNAVAILABLE" };
    }
    return (await res.json()) as PonderAgentAuthorizationsResponse;
  } catch {
    return { ...EMPTY_AUTHORIZATIONS, page, limit, ponderError: "PONDER_UNAVAILABLE" };
  }
}

export async function getAgentListings(
  address: string,
  page = 1,
  limit = 20,
  active?: boolean,
): Promise<PonderAgentListingsResponse & { ponderError?: string }> {
  const agent = parseAgentAddress(address);
  if (!agent) return { ...EMPTY_LISTINGS, page, limit };

  try {
    const url = new URL(`${PONDER_URL}/agents/${agent}/listings`);
    url.searchParams.set("page", String(page));
    url.searchParams.set("limit", String(limit));
    if (active === true) url.searchParams.set("active", "true");
    else if (active === false) url.searchParams.set("active", "false");
    const res = await fetch(url.toString(), { next: { revalidate: 30 } });
    if (!res.ok) {
      return { ...EMPTY_LISTINGS, page, limit, ponderError: "PONDER_UNAVAILABLE" };
    }
    return (await res.json()) as PonderAgentListingsResponse;
  } catch {
    return { ...EMPTY_LISTINGS, page, limit, ponderError: "PONDER_UNAVAILABLE" };
  }
}

export type AgentConsignmentCountResult = {
  count: number | null;
  ponderError?: string;
};

export async function getAgentConsignmentCount(
  address: string,
): Promise<AgentConsignmentCountResult> {
  const agent = parseAgentAddress(address);
  if (!agent) return { count: null };

  try {
    const url = new URL(`${PONDER_URL}/agents/${agent}/authorizations`);
    url.searchParams.set("page", "1");
    url.searchParams.set("limit", "1");
    const res = await fetch(url.toString(), { next: { revalidate: 30 } });
    if (!res.ok) return { count: null, ponderError: "PONDER_UNAVAILABLE" };
    const data = (await res.json()) as PonderAgentAuthorizationsResponse;
    return { count: data.total };
  } catch {
    return { count: null, ponderError: "PONDER_UNAVAILABLE" };
  }
}

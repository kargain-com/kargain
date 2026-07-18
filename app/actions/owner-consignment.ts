"use server";

import { getAddress } from "viem";

import type { PonderAuctionAuthorizationsResponse } from "@/app/actions/auction-agent";
import type { PonderAgentAuthorizationsResponse } from "@/lib/types/ponder";

const PONDER_URL =
  process.env.PONDER_SQL_API_URL ?? "http://localhost:42069";

const EMPTY_AUTHORIZATIONS: PonderAgentAuthorizationsResponse = {
  authorizations: [],
  total: 0,
  page: 1,
  limit: 20,
};

const EMPTY_AUCTION_AUTHS: PonderAuctionAuthorizationsResponse = {
  authorizations: [],
  total: 0,
  page: 1,
  limit: 20,
};

function parseOwnerAddress(address: string): `0x${string}` | null {
  try {
    return getAddress(address);
  } catch {
    return null;
  }
}

export async function getOwnerAuthorizations(
  address: string,
  page = 1,
  limit = 20,
  hasActiveListing?: boolean,
): Promise<PonderAgentAuthorizationsResponse & { ponderError?: string }> {
  const owner = parseOwnerAddress(address);
  if (!owner) return { ...EMPTY_AUTHORIZATIONS, page, limit };

  try {
    const url = new URL(`${PONDER_URL}/owners/${owner}/authorizations`);
    url.searchParams.set("page", String(page));
    url.searchParams.set("limit", String(limit));
    if (hasActiveListing === false) {
      url.searchParams.set("hasActiveListing", "false");
    } else if (hasActiveListing === true) {
      url.searchParams.set("hasActiveListing", "true");
    }
    const res = await fetch(url.toString(), { next: { revalidate: 30 } });
    if (!res.ok) {
      return {
        ...EMPTY_AUTHORIZATIONS,
        page,
        limit,
        ponderError: "PONDER_UNAVAILABLE",
      };
    }
    return (await res.json()) as PonderAgentAuthorizationsResponse;
  } catch {
    return {
      ...EMPTY_AUTHORIZATIONS,
      page,
      limit,
      ponderError: "PONDER_UNAVAILABLE",
    };
  }
}

export async function getOwnerAuctionAuthorizations(
  address: string,
  page = 1,
  limit = 20,
  awaiting?: boolean,
): Promise<PonderAuctionAuthorizationsResponse> {
  const owner = parseOwnerAddress(address);
  if (!owner) return { ...EMPTY_AUCTION_AUTHS, page, limit };

  try {
    const url = new URL(
      `${PONDER_URL}/owners/${owner}/auction-authorizations`,
    );
    url.searchParams.set("page", String(page));
    url.searchParams.set("limit", String(limit));
    if (awaiting === true) {
      url.searchParams.set("awaiting", "true");
    } else if (awaiting === false) {
      url.searchParams.set("awaiting", "false");
    }
    const res = await fetch(url.toString(), { next: { revalidate: 30 } });
    if (!res.ok) {
      return {
        ...EMPTY_AUCTION_AUTHS,
        page,
        limit,
        ponderError: "PONDER_UNAVAILABLE",
      };
    }
    return (await res.json()) as PonderAuctionAuthorizationsResponse;
  } catch {
    return {
      ...EMPTY_AUCTION_AUTHS,
      page,
      limit,
      ponderError: "PONDER_UNAVAILABLE",
    };
  }
}

export type OwnerDelegatedCountResult = {
  count: number | null;
  ponderError?: string;
};

export async function getOwnerDelegatedCount(
  address: string,
): Promise<OwnerDelegatedCountResult> {
  const owner = parseOwnerAddress(address);
  if (!owner) return { count: null };

  try {
    const url = new URL(`${PONDER_URL}/owners/${owner}/authorizations`);
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

"use server";

import { getAddress } from "viem";

import type {
  AgentActiveAuctionsResult,
  PonderAuctionAuthorizationsResponse,
} from "@/app/actions/auction-agent";
import {
  mapPonderAuctionRow,
  type PonderAuctionRaw,
} from "@/lib/auction/map-ponder-auction";
import type { PonderAgentAuthorizationsResponse } from "@/lib/types/ponder";
import { DEFAULT_CHAIN_ID } from "@/lib/web3/supported-chains";

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

type PonderAuctionsResponse = {
  auctions: PonderAuctionRaw[];
  total: number;
  page: number;
  limit: number;
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
    const res = await fetch(url.toString(), { cache: "no-store" });
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
    const res = await fetch(url.toString(), { cache: "no-store" });
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
    const res = await fetch(url.toString(), { cache: "no-store" });
    if (!res.ok) return { count: null, ponderError: "PONDER_UNAVAILABLE" };
    const data = (await res.json()) as PonderAgentAuthorizationsResponse;
    return { count: data.total };
  } catch {
    return { count: null, ponderError: "PONDER_UNAVAILABLE" };
  }
}

/** Active auctions where the address is the seller (owner-out portfolio). */
export async function getOwnerActiveAuctions(
  address: string,
  page = 1,
  limit = 20,
  chainId: number = DEFAULT_CHAIN_ID,
): Promise<AgentActiveAuctionsResult> {
  const owner = parseOwnerAddress(address);
  if (!owner) {
    return { ok: true, rows: [], total: 0, page, limit };
  }

  try {
    const url = new URL(`${PONDER_URL}/auctions`);
    url.searchParams.set("seller", owner);
    url.searchParams.set("active", "true");
    url.searchParams.set("page", String(page));
    url.searchParams.set("limit", String(limit));

    const res = await fetch(url.toString(), { cache: "no-store" });
    if (!res.ok) {
      return {
        ok: true,
        rows: [],
        total: 0,
        page,
        limit,
        ponderError: "PONDER_UNAVAILABLE",
      };
    }

    const data = (await res.json()) as PonderAuctionsResponse;
    const rows = (data.auctions ?? []).map((row) =>
      mapPonderAuctionRow(row, chainId),
    );
    return {
      ok: true,
      rows,
      total: data.total ?? rows.length,
      page: data.page ?? page,
      limit: data.limit ?? limit,
    };
  } catch {
    return {
      ok: true,
      rows: [],
      total: 0,
      page,
      limit,
      ponderError: "PONDER_UNAVAILABLE",
    };
  }
}

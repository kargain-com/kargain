"use server";

import { getAddress } from "viem";

import {
  mapPonderAuctionRow,
  type AuctionRow,
  type PonderAuctionRaw,
} from "@/lib/auction/map-ponder-auction";

const PONDER_URL =
  process.env.PONDER_SQL_API_URL ?? "http://localhost:42069";

export type PonderAuctionAuthorizationRaw = {
  tokenId: string;
  owner: string;
  agent: string;
  expiry: string | number;
  asset: string;
  ownerMinAsset: string | number;
  active: boolean;
  hasActiveAuction?: boolean;
  createdAt?: string | number;
  updatedAt?: string | number;
  make?: string | null;
  model?: string | null;
  year?: number | null;
  vin?: string | null;
  coverPhotoUri?: string | null;
  title?: string | null;
  passportStatus?: string | null;
};

export type PonderAuctionAuthorizationsResponse = {
  authorizations: PonderAuctionAuthorizationRaw[];
  total: number;
  page: number;
  limit: number;
  ponderError?: string;
};

export type AgentActiveAuctionsResult = {
  ok: true;
  rows: AuctionRow[];
  total: number;
  page: number;
  limit: number;
  ponderError?: string;
};

const EMPTY_AUTHS: PonderAuctionAuthorizationsResponse = {
  authorizations: [],
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

export async function getAgentAuctionAuthorizations(
  address: string,
  page = 1,
  limit = 20,
  awaiting?: boolean,
): Promise<PonderAuctionAuthorizationsResponse> {
  const agent = parseAgentAddress(address);
  if (!agent) return { ...EMPTY_AUTHS, page, limit };

  try {
    const url = new URL(
      `${PONDER_URL}/agents/${agent}/auction-authorizations`,
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
        ...EMPTY_AUTHS,
        page,
        limit,
        ponderError: "PONDER_UNAVAILABLE",
      };
    }
    return (await res.json()) as PonderAuctionAuthorizationsResponse;
  } catch {
    return {
      ...EMPTY_AUTHS,
      page,
      limit,
      ponderError: "PONDER_UNAVAILABLE",
    };
  }
}

type PonderAuctionsResponse = {
  auctions: PonderAuctionRaw[];
  total: number;
  page: number;
  limit: number;
};

export async function getAgentActiveAuctions(
  address: string,
  page = 1,
  limit = 20,
  _chainId?: number,
): Promise<AgentActiveAuctionsResult> {
  void _chainId;
  const agent = parseAgentAddress(address);
  if (!agent) {
    return { ok: true, rows: [], total: 0, page, limit };
  }

  try {
    const url = new URL(`${PONDER_URL}/auctions`);
    url.searchParams.set("agent", agent);
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
    const rows = (data.auctions ?? []).map((row) => mapPonderAuctionRow(row));
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

"use server";

import { getAddress } from "viem";

import { buildPonderUrl, ponderFetch } from "@/lib/web3/ponder-fetch";

export type PendingClaimCreditApiRow = {
  id: string;
  amount: string;
  reasonCode: string;
  timestamp: string;
};

export type PendingClaimApiRow = {
  id: string;
  chainId: number;
  contract: string;
  account: string;
  asset: string;
  amount: string;
  reasonCode: string;
  updatedAt: string;
  firstCreditedAt: string;
  /** Ledger credits for this four-tuple (chronological). */
  credits: PendingClaimCreditApiRow[];
};

export type PendingClaimsResponse = {
  claims: PendingClaimApiRow[];
  total: number;
  page: number;
  limit: number;
  ponderError?: string;
};

const EMPTY: PendingClaimsResponse = {
  claims: [],
  total: 0,
  page: 1,
  limit: 50,
};

function parseAccount(address: string): `0x${string}` | null {
  try {
    return getAddress(address);
  } catch {
    return null;
  }
}

export async function getPendingClaims(
  address: string,
  page = 1,
  limit = 50,
  chainId?: number,
): Promise<PendingClaimsResponse> {
  const account = parseAccount(address);
  if (!account) return { ...EMPTY, page, limit };

  try {
    const url = buildPonderUrl(
      "accounts.claims",
      { address: account },
      {
        page,
        limit,
        chainId:
          chainId != null && Number.isFinite(chainId) ? chainId : undefined,
      },
    );
    const res = await ponderFetch(url.toString());
    if (!res.ok) {
      return { ...EMPTY, page, limit, ponderError: "PONDER_UNAVAILABLE" };
    }
    return (await res.json()) as PendingClaimsResponse;
  } catch {
    return { ...EMPTY, page, limit, ponderError: "PONDER_UNAVAILABLE" };
  }
}

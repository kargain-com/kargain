"use server";

import { getAddress } from "viem";

import type { PonderErrorCode } from "@/lib/types/ponder";
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

export type PendingClaimsResult =
  | {
      ok: true;
      claims: PendingClaimApiRow[];
      total: number;
      page: number;
      limit: number;
    }
  | { ok: false; error: PonderErrorCode | "INVALID_ADDRESS" };

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
): Promise<PendingClaimsResult> {
  const account = parseAccount(address);
  if (!account) return { ok: false, error: "INVALID_ADDRESS" };

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
    const res = await ponderFetch("pending-claims", url.toString());
    if (!res.ok) {
      return { ok: false, error: "PONDER_UNAVAILABLE" };
    }
    const body = res.body as {
      claims: PendingClaimApiRow[];
      total: number;
      page?: number;
      limit?: number;
    };
    return {
      ok: true,
      claims: body.claims,
      total: body.total,
      page: body.page ?? page,
      limit: body.limit ?? limit,
    };
  } catch {
    return { ok: false, error: "PONDER_UNAVAILABLE" };
  }
}

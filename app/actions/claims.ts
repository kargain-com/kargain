"use server";

import { getAddress } from "viem";
import { z } from "zod";

import type { PendingClaimsReadCause } from "@/lib/claims/pending-claims-fact";
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
    }
  | {
      ok: false;
      error: PendingClaimsReadCause;
    };

const pendingClaimCreditSchema = z.object({
  id: z.string(),
  amount: z.string(),
  reasonCode: z.string(),
  timestamp: z.string(),
});

const pendingClaimRowSchema = z.object({
  id: z.string(),
  chainId: z.number(),
  contract: z.string(),
  account: z.string(),
  asset: z.string(),
  amount: z.string(),
  reasonCode: z.string(),
  updatedAt: z.string(),
  firstCreditedAt: z.string(),
  credits: z.array(pendingClaimCreditSchema),
});

const pendingClaimsBodySchema = z.object({
  claims: z.array(pendingClaimRowSchema),
  total: z.number(),
});

function parseAccount(address: string): `0x${string}` | null {
  try {
    return getAddress(address);
  } catch {
    return null;
  }
}

/**
 * Pending claims from Ponder. Transport failure → PONDER_UNAVAILABLE;
 * schema failure → PONDER_MALFORMED_RESPONSE. Programmer errors in URL
 * construction throw (no catch).
 */
export async function getPendingClaims(
  address: string,
  page = 1,
  limit = 50,
  chainId?: number,
): Promise<PendingClaimsResult> {
  const account = parseAccount(address);
  if (!account) return { ok: false, error: "INVALID_ADDRESS" };

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
  const parsed = pendingClaimsBodySchema.safeParse(res.body);
  if (!parsed.success) {
    return { ok: false, error: "PONDER_MALFORMED_RESPONSE" };
  }
  return {
    ok: true,
    claims: parsed.data.claims,
    total: parsed.data.total,
  };
}

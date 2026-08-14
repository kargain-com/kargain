"use server";

import { getAddress, zeroAddress } from "viem";

import { buildPonderUrl, ponderFetch } from "@/lib/web3/ponder-fetch";

export type CommercePaymentTokenRow = {
  chainId: number;
  mode: string;
  modeContract: string;
  token: string;
  decimals: number;
  /** Indexer projection — not write authority; chain `enabled` owns the CTA. */
  active: boolean;
};

type PaymentTokensResponse = {
  paymentTokens?: Array<{
    chainId?: number;
    mode?: string;
    modeContract?: string;
    token?: string;
    decimals?: number;
    active?: boolean;
  }>;
  total?: number;
};

/**
 * Candidate payment-token addresses for ops soft-revoke discovery.
 * Includes inactive rows so operators see already-revoked state. Chain
 * `enabled` remains the write gate.
 */
export async function getCommercePaymentTokenCandidates(): Promise<{
  tokens: CommercePaymentTokenRow[];
  ponderError?: "PONDER_UNAVAILABLE";
}> {
  const url = buildPonderUrl("commerce.paymentTokens", {}, { limit: 200 });

  try {
    const res = await ponderFetch("commerce-payment-tokens", url.toString());
    if (!res.ok) return { tokens: [], ponderError: "PONDER_UNAVAILABLE" };
    const json = res.body as PaymentTokensResponse;
    const tokens: CommercePaymentTokenRow[] = [];
    for (const row of json.paymentTokens ?? []) {
      if (
        row?.chainId == null ||
        !Number.isFinite(row.chainId) ||
        !row.token ||
        !row.modeContract ||
        !row.mode
      ) {
        continue;
      }
      let token: string;
      let modeContract: string;
      try {
        token = getAddress(row.token);
        modeContract = getAddress(row.modeContract);
      } catch {
        continue;
      }
      if (token.toLowerCase() === zeroAddress) continue;
      tokens.push({
        chainId: row.chainId,
        mode: row.mode,
        modeContract,
        token,
        decimals: Number.isFinite(row.decimals) ? Number(row.decimals) : 0,
        active: row.active !== false,
      });
    }
    return { tokens };
  } catch {
    return { tokens: [], ponderError: "PONDER_UNAVAILABLE" };
  }
}

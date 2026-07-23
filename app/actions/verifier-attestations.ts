"use server";

import type { PonderVerifierAttestationsResponse } from "@/lib/types/ponder";
import { ponderBaseUrl, ponderFetch } from "@/lib/web3/ponder-fetch";

const EMPTY_RESPONSE: PonderVerifierAttestationsResponse = {
  attestations: [],
  total: 0,
  limit: 20,
  offset: 0,
};

export async function getVerifierAttestations(
  address: string,
  offset = 0,
  limit = 20,
): Promise<PonderVerifierAttestationsResponse> {
  try {
    const url = new URL(`${ponderBaseUrl()}/verifiers/${address}/attestations`);
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("offset", String(offset));
    const res = await ponderFetch(url.toString());
    if (!res.ok) return { ...EMPTY_RESPONSE, limit, offset };
    return (await res.json()) as PonderVerifierAttestationsResponse;
  } catch {
    return { ...EMPTY_RESPONSE, limit, offset };
  }
}

"use server";

import type { PonderVerifierAttestationsResponse } from "@/lib/types/ponder";

const PONDER_URL =
  process.env.PONDER_SQL_API_URL ?? "http://localhost:42069";

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
    const url = new URL(`${PONDER_URL}/verifiers/${address}/attestations`);
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("offset", String(offset));
    const res = await fetch(url.toString(), { next: { revalidate: 30 } });
    if (!res.ok) return { ...EMPTY_RESPONSE, limit, offset };
    return (await res.json()) as PonderVerifierAttestationsResponse;
  } catch {
    return { ...EMPTY_RESPONSE, limit, offset };
  }
}

"use server";

import type { PonderVerifierAttestationsResponse } from "@/lib/types/ponder";
import { buildPonderUrl, ponderFetch } from "@/lib/web3/ponder-fetch";

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
    const url = buildPonderUrl(
      "verifiers.attestations",
      { address },
      { limit, offset },
    );
    const res = await ponderFetch("verifiers", url.toString());
    if (!res.ok) return { ...EMPTY_RESPONSE, limit, offset };
    return res.body as PonderVerifierAttestationsResponse;
  } catch {
    return { ...EMPTY_RESPONSE, limit, offset };
  }
}

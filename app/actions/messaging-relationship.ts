"use server";

import { getAddress, type Address } from "viem";

import { buildPonderUrl, ponderFetch } from "@/lib/web3/ponder-fetch";

/**
 * Verifier addresses recorded on passports owned by `address`.
 * Used only by messaging relationship auto-allow (P9) — not profile chrome.
 */
export async function getOwnerPassportVerifierAddresses(
  address: string,
): Promise<Address[]> {
  let owner: Address;
  try {
    owner = getAddress(address as `0x${string}`);
  } catch {
    return [];
  }
  try {
    const res = await ponderFetch(
      buildPonderUrl("profile.passports", { address: owner }).toString(),
    );
    if (!res.ok) return [];
    const body = (await res.json()) as { passports?: unknown[] };
    const out: Address[] = [];
    for (const raw of body.passports ?? []) {
      if (raw == null || typeof raw !== "object" || Array.isArray(raw)) continue;
      const verifier = (raw as Record<string, unknown>).verifier;
      if (typeof verifier !== "string" || !verifier.trim()) continue;
      try {
        out.push(getAddress(verifier as `0x${string}`));
      } catch {
        // skip invalid
      }
    }
    return out;
  } catch {
    return [];
  }
}

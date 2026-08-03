"use server";

import { readActiveVerifierMemberships } from "@/lib/kar-pro/is-active-verifier-commercial";
import { filterVerifierDirectoryEntries } from "@/lib/verifier/effective-verifier";
import {
  parseVerifierDirectoryEntry,
  type PonderVerifierDirectoryRow,
  type VerifierDirectoryEntry,
} from "@/lib/verifier/parse-directory-entry";
import { ponderBaseUrl, ponderFetch } from "@/lib/web3/ponder-fetch";

type VerifierDirectoryResult = {
  verifiers: VerifierDirectoryEntry[];
};

type PonderVerifiersRawResponse = {
  verifiers: PonderVerifierDirectoryRow[];
};

async function fetchPonderVerifiers(): Promise<VerifierDirectoryEntry[]> {
  const res = await ponderFetch(`${ponderBaseUrl()}/verifiers`);
  if (!res.ok) return [];
  const data = (await res.json()) as PonderVerifiersRawResponse;
  return (data.verifiers ?? [])
    .map(parseVerifierDirectoryEntry)
    .filter((v): v is VerifierDirectoryEntry => v != null);
}

/**
 * Ponder discovery list filtered by per-membership chain `isActiveVerifier`
 * when the batch succeeds; Ponder-only fallback when every chain read fails.
 */
async function fetchEffectiveVerifiers(): Promise<VerifierDirectoryEntry[]> {
  const rows = await fetchPonderVerifiers();
  const batch = await readActiveVerifierMemberships(
    rows.map((row) => ({ chainId: row.chainId, address: row.address })),
  );
  if (batch.status === "failure") {
    return filterVerifierDirectoryEntries(rows, "failure", new Map());
  }
  return filterVerifierDirectoryEntries(rows, "success", batch.activeByMembership);
}

/** Lightweight count for homepage stats — no Nostr relay round-trips. */
export async function fetchActiveVerifierCount(): Promise<number> {
  try {
    const verifiers = await fetchEffectiveVerifiers();
    return verifiers.length;
  } catch {
    return 0;
  }
}

export async function getVerifierDirectory(): Promise<VerifierDirectoryResult> {
  try {
    const verifiers = await fetchEffectiveVerifiers();
    return { verifiers };
  } catch {
    return { verifiers: [] };
  }
}

"use server";

import { readActiveVerifierMemberships } from "@/lib/kar-pro/is-active-verifier-commercial";
import { filterVerifierDirectoryEntries } from "@/lib/verifier/effective-verifier";
import { ponderBaseUrl, ponderFetch } from "@/lib/web3/ponder-fetch";

export type VerifierDirectoryEntry = {
  /** Commercial chain of this membership (SPEC §I.12.12). */
  chainId: number;
  address: `0x${string}`;
  category: number;
  name: string;
  slug: string;
  metadataURI: string;
  active: boolean;
  verificationCount: number;
  verificationFee: string;
  joinedAt: number;
  locationLabel: string;
  locationPlaceId: string;
  locationCountryCode: string;
};

export type VerifierDirectoryResult = {
  verifiers: VerifierDirectoryEntry[];
};

type ParsedVerifierDirectoryEntry = VerifierDirectoryEntry;

type PonderVerifiersRawResponse = {
  verifiers: Array<{
    id?: string;
    chainId?: number | string;
    address: string;
    category: number;
    name: string;
    slug?: string;
    metadataURI: string;
    active: boolean;
    verificationCount: number;
    verificationFee?: string | number;
    joinedAt?: string | number;
    locationLabel?: string;
    locationPlaceId?: string;
    locationCountryCode?: string;
  }>;
};

function parseVerificationFeeWire(raw: unknown): string {
  if (raw == null || raw === "") return "0";
  const s = String(raw).trim();
  try {
    BigInt(s);
    return s;
  } catch {
    return "0";
  }
}

function parsePositiveChainId(raw: unknown): number | null {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) return null;
  return n;
}

/** Parse one Ponder directory row; drop when chainId missing/invalid. */
export function parseVerifierDirectoryEntry(
  row: PonderVerifiersRawResponse["verifiers"][number],
): ParsedVerifierDirectoryEntry | null {
  const address = (row.address || row.id || "").trim();
  if (!address.startsWith("0x")) return null;
  const chainId = parsePositiveChainId(row.chainId);
  if (chainId == null) return null;
  return {
    chainId,
    address: address as `0x${string}`,
    category: Number(row.category ?? 5),
    name: String(row.name ?? ""),
    slug: String(row.slug ?? ""),
    metadataURI: String(row.metadataURI ?? ""),
    active: row.active === true,
    verificationCount: Number(row.verificationCount ?? 0),
    verificationFee: parseVerificationFeeWire(row.verificationFee),
    joinedAt: Number(row.joinedAt ?? 0),
    locationLabel: String(row.locationLabel ?? "").trim(),
    locationPlaceId: String(row.locationPlaceId ?? "").trim(),
    locationCountryCode: String(row.locationCountryCode ?? "").trim().toUpperCase(),
  };
}

async function fetchPonderVerifiers(): Promise<ParsedVerifierDirectoryEntry[]> {
  const res = await ponderFetch(`${ponderBaseUrl()}/verifiers`);
  if (!res.ok) return [];
  const data = (await res.json()) as PonderVerifiersRawResponse;
  return (data.verifiers ?? [])
    .map(parseVerifierDirectoryEntry)
    .filter((v): v is ParsedVerifierDirectoryEntry => v != null);
}

/**
 * Ponder discovery list filtered by per-membership chain `isActiveVerifier`
 * when the batch succeeds; Ponder-only fallback when every chain read fails.
 */
async function fetchEffectiveVerifiers(): Promise<ParsedVerifierDirectoryEntry[]> {
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

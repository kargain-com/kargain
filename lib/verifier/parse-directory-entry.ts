/**
 * Pure parse for Ponder `GET /verifiers` directory rows.
 * Lives outside `"use server"` — Next requires server-action exports to be async.
 */

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

export type PonderVerifierDirectoryRow = {
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
  row: PonderVerifierDirectoryRow,
): VerifierDirectoryEntry | null {
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

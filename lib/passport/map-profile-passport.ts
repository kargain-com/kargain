import {
  isIndexedPhaseLive,
  type ConsignmentRecord,
} from "@/lib/commerce/ponder-consignment";
import type { CustodyUnresolvedCause, PassportStatus } from "@/lib/types/ponder";
import { resolveUri } from "@/lib/storage/resolve-uri";

export type ProfilePassportRow = {
  tokenId: string;
  status: PassportStatus;
  vin: string | null;
  make: string;
  model: string;
  year: number;
  /** Resolved cover HTTP URL, or null when absent. */
  imageUrl: string | null;
  /** Origin / mint home. */
  chainId: number;
  /** Where the token lives now — detail links use this when resolved. */
  custodyChain: number | null;
  custodyUnresolved?: CustodyUnresolvedCause | null;
};

export type ProfileListingRow = {
  tokenId: string;
  passportStatus: PassportStatus;
  make: string;
  model: string;
  year: number;
  vin: string | null;
  imageUrl: string | null;
  /** Commerce chain for detail links when custody resolved. */
  custodyChain: number | null;
  custodyUnresolved?: CustodyUnresolvedCause | null;
  originChainId?: number;
};

function parseChainIdField(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) return null;
  return n;
}

function isPassportStatus(value: string): value is PassportStatus {
  return value === "UNVERIFIED" || value === "VERIFIED" || value === "DISPUTED";
}

function parseYear(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
}

function parseOptionalString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function parseVin(value: unknown): string | null {
  const v = parseOptionalString(value);
  return v ? v : null;
}

function coverImageUrl(coverPhotoUri: unknown): string | null {
  if (typeof coverPhotoUri !== "string" || !coverPhotoUri.trim()) return null;
  return resolveUri(coverPhotoUri);
}

/** True when the passport lives off its origin chain. */
export function isProfilePassportBridgedAway(
  chainId: number,
  custodyChain: number | null,
): boolean {
  if (custodyChain == null) return false;
  return custodyChain !== chainId;
}

function parseCustodyUnresolved(value: unknown): CustodyUnresolvedCause | null | undefined {
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  const causes: CustodyUnresolvedCause[] = [
    "empty_history",
    "departure_without_arrival",
    "incomplete_crossing_link",
    "unknown_namespace",
    "conflicting_determination",
  ];
  return causes.includes(value as CustodyUnresolvedCause)
    ? (value as CustodyUnresolvedCause)
    : undefined;
}

/**
 * Map a Ponder profile passport row. Fail-closed without origin + custody answer.
 */
export function mapProfilePassport(raw: unknown): ProfilePassportRow | null {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;

  const tokenId = typeof obj.id === "string" ? obj.id : String(obj.id ?? "");
  const statusRaw = typeof obj.status === "string" ? obj.status : "";
  const chainId = parseChainIdField(obj.chainId);
  const custodyChainRaw = obj.custodyChain;
  const custodyChain =
    custodyChainRaw == null ? null : parseChainIdField(custodyChainRaw);
  const custodyUnresolved = parseCustodyUnresolved(obj.custodyUnresolved);

  const hasResolved = custodyChain != null && custodyUnresolved == null;
  const hasUnresolved =
    custodyChain == null && custodyUnresolved != null && custodyUnresolved !== undefined;

  if (
    !tokenId ||
    !isPassportStatus(statusRaw) ||
    chainId == null ||
    (!hasResolved && !hasUnresolved)
  ) {
    return null;
  }

  return {
    tokenId,
    status: statusRaw,
    vin: parseVin(obj.vin),
    make: parseOptionalString(obj.make),
    model: parseOptionalString(obj.model),
    year: parseYear(obj.year),
    imageUrl: coverImageUrl(obj.coverPhotoUri),
    chainId,
    custodyChain: hasResolved ? custodyChain : null,
    custodyUnresolved: hasUnresolved ? custodyUnresolved : null,
  };
}

/**
 * Map a live seller consignment onto the profile Listings tile.
 * Live = offered | binding (HTTP `active=true` / OPEN_PHASES).
 */
export function mapProfileListingFromConsignment(
  row: ConsignmentRecord,
): ProfileListingRow | null {
  if (!isIndexedPhaseLive(row.phase)) return null;

  const statusRaw = row.status ?? "UNVERIFIED";
  if (!isPassportStatus(statusRaw)) return null;
  if (!row.tokenId) return null;

  return {
    tokenId: row.tokenId,
    passportStatus: statusRaw,
    make: row.make?.trim() ?? "",
    model: row.model?.trim() ?? "",
    year: parseYear(row.year),
    vin: parseVin(row.vin),
    imageUrl: coverImageUrl(row.coverPhotoUri),
    custodyChain: row.custodyChain,
    custodyUnresolved: row.custodyUnresolved ?? null,
    originChainId: row.originChainId,
  };
}

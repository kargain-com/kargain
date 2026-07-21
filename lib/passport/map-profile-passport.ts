import type { PassportStatus } from "@/lib/types/ponder";

export type ProfilePassportRow = {
  tokenId: string;
  status: PassportStatus;
  vin: string | null;
  /** Origin / mint home. */
  chainId: number;
  /** Where the token lives now — detail links use this. */
  custodyChain: number;
};

export type ProfileListingRow = {
  tokenId: string;
  passportStatus: PassportStatus;
  make?: string;
  model?: string;
  /** Commerce chain for detail links (custody preferred). */
  custodyChain: number;
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

/** True when the passport lives off its origin chain. */
export function isProfilePassportBridgedAway(
  chainId: number,
  custodyChain: number,
): boolean {
  return custodyChain !== chainId;
}

/**
 * Map a Ponder profile passport row. Fail-closed without origin + custody.
 */
export function mapProfilePassport(raw: unknown): ProfilePassportRow | null {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;

  const tokenId = typeof obj.id === "string" ? obj.id : String(obj.id ?? "");
  const statusRaw = typeof obj.status === "string" ? obj.status : "";
  const chainId = parseChainIdField(obj.chainId);
  const custodyChain = parseChainIdField(obj.custodyChain);
  const vin =
    typeof obj.vin === "string" && obj.vin.trim() ? obj.vin.trim() : null;

  if (!tokenId || !isPassportStatus(statusRaw) || chainId == null || custodyChain == null) {
    return null;
  }

  return {
    tokenId,
    status: statusRaw,
    vin,
    chainId,
    custodyChain,
  };
}

/**
 * Map an enriched profile listing. Prefer custodyChain, then listing chainId.
 */
export function mapProfileListing(raw: unknown): ProfileListingRow | null {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;

  if (obj.active !== true && obj.active !== "true") return null;

  const tokenId = String(obj.tokenId ?? obj.id ?? "");
  const statusRaw =
    typeof obj.passportStatus === "string" ? obj.passportStatus : "UNVERIFIED";
  const custodyChain =
    parseChainIdField(obj.custodyChain) ?? parseChainIdField(obj.chainId);
  const originChainId =
    parseChainIdField(obj.originChainId) ?? parseChainIdField(obj.chainId) ?? undefined;

  if (!tokenId || !isPassportStatus(statusRaw) || custodyChain == null) {
    return null;
  }

  return {
    tokenId,
    passportStatus: statusRaw,
    make: typeof obj.make === "string" ? obj.make : undefined,
    model: typeof obj.model === "string" ? obj.model : undefined,
    custodyChain,
    originChainId,
  };
}

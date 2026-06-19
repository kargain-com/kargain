import { KarPassportAbi } from "@/lib/contracts/abis.generated";
import {
  fetchArweaveMetadata,
  type PassportMetadata,
} from "@/lib/passport/fetch-arweave-metadata";
import { passportStatusFromChainIndex } from "@/lib/passport/passport-status-chain";
import type {
  PassportStatus,
  PonderPassportDetail,
  PonderUriHistoryEntry,
} from "@/lib/types/ponder";
import { karPassportAddress } from "@/lib/web3/deployment-addresses";
import { getPublicClient } from "@/lib/web3/public-client";

const PONDER_URL =
  process.env.PONDER_SQL_API_URL ?? "http://localhost:42069";

export type PassportDetailResult =
  | {
      ok: true;
      passport: PonderPassportDetail;
      metadata: PassportMetadata | null;
      metadataError?: boolean;
    }
  | { ok: false; error: "NOT_FOUND" }
  | { ok: false; error: "PONDER_UNAVAILABLE" };

function isPassportStatus(value: string): value is PassportStatus {
  return value === "UNVERIFIED" || value === "VERIFIED" || value === "DISPUTED";
}

function parseUriHistory(raw: unknown): PonderUriHistoryEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => {
      if (entry == null || typeof entry !== "object" || Array.isArray(entry)) {
        return null;
      }
      const e = entry as Record<string, unknown>;
      const id = typeof e.id === "string" ? e.id : "";
      const tokenId = typeof e.tokenId === "string" ? e.tokenId : "";
      const previousUri = typeof e.previousUri === "string" ? e.previousUri : "";
      const newUri = typeof e.newUri === "string" ? e.newUri : "";
      const author = typeof e.author === "string" ? e.author : "";
      const verificationReset = e.verificationReset === true;
      const timestamp = e.timestamp != null ? String(e.timestamp) : "0";
      if (!id || !newUri) return null;
      return {
        id,
        tokenId,
        previousUri,
        newUri,
        author,
        verificationReset,
        timestamp,
      };
    })
    .filter((e): e is PonderUriHistoryEntry => e != null);
}

function parsePonderPassport(raw: unknown): PonderPassportDetail | null {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;

  const id = typeof obj.id === "string" ? obj.id : "";
  const owner = typeof obj.owner === "string" ? obj.owner : "";
  const statusRaw = typeof obj.status === "string" ? obj.status : "";
  const verifier = typeof obj.verifier === "string" ? obj.verifier : "";
  const verifiedAt = obj.verifiedAt != null ? String(obj.verifiedAt) : "0";
  const tokenUri = typeof obj.tokenUri === "string" ? obj.tokenUri : "";
  const vin = typeof obj.vin === "string" ? obj.vin : "";
  const make = typeof obj.make === "string" ? obj.make : "";
  const model = typeof obj.model === "string" ? obj.model : "";
  const year = typeof obj.year === "number" ? obj.year : Number(obj.year ?? 0);
  const mileageKm =
    typeof obj.mileageKm === "number" ? obj.mileageKm : Number(obj.mileageKm ?? 0);
  const lastDisputer = typeof obj.lastDisputer === "string" ? obj.lastDisputer : "";
  const disputeReason = typeof obj.disputeReason === "string" ? obj.disputeReason : "";
  const disputeWithdrawnAt =
    obj.disputeWithdrawnAt != null ? String(obj.disputeWithdrawnAt) : "0";
  const lastVerificationResetAt =
    obj.lastVerificationResetAt != null ? String(obj.lastVerificationResetAt) : "0";
  const duplicateVin = obj.duplicateVin === true;
  const lastMetadataChangeAt =
    obj.lastMetadataChangeAt != null ? String(obj.lastMetadataChangeAt) : "0";
  const verificationResetCount =
    typeof obj.verificationResetCount === "number"
      ? obj.verificationResetCount
      : Number(obj.verificationResetCount ?? 0);
  const hadDispute = obj.hadDispute === true;
  const lastDisputeResolvedAt =
    obj.lastDisputeResolvedAt != null ? String(obj.lastDisputeResolvedAt) : "0";
  const disputeOpenedAt =
    obj.disputeOpenedAt != null ? String(obj.disputeOpenedAt) : "0";
  const fuelType = typeof obj.fuelType === "string" ? obj.fuelType : "";
  const bodyType = typeof obj.bodyType === "string" ? obj.bodyType : "";
  const transmission = typeof obj.transmission === "string" ? obj.transmission : "";
  const createdAt = obj.createdAt != null ? String(obj.createdAt) : "0";
  const updatedAt = obj.updatedAt != null ? String(obj.updatedAt) : "0";

  if (!id || !owner || !isPassportStatus(statusRaw)) return null;

  const recordsRaw = Array.isArray(obj.records) ? obj.records : [];
  const records = recordsRaw
    .map((r) => {
      if (r == null || typeof r !== "object" || Array.isArray(r)) return null;
      const rec = r as Record<string, unknown>;
      const recId = typeof rec.id === "string" ? rec.id : "";
      const tokenId = typeof rec.tokenId === "string" ? rec.tokenId : id;
      const author = typeof rec.author === "string" ? rec.author : "";
      const recordType = typeof rec.recordType === "string" ? rec.recordType : "";
      const description = typeof rec.description === "string" ? rec.description : "";
      const evidenceCID = typeof rec.evidenceCID === "string" ? rec.evidenceCID : "";
      const timestamp = rec.timestamp != null ? String(rec.timestamp) : "0";
      if (!recId || !author || !recordType) return null;
      return {
        id: recId,
        tokenId,
        author,
        recordType,
        description,
        evidenceCID,
        timestamp,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r != null);

  return {
    id,
    owner,
    status: statusRaw,
    verifier,
    verifiedAt,
    tokenUri,
    vin,
    make,
    model,
    year: Number.isFinite(year) ? year : 0,
    mileageKm: Number.isFinite(mileageKm) ? mileageKm : 0,
    lastDisputer,
    disputeReason,
    disputeWithdrawnAt,
    lastVerificationResetAt,
    duplicateVin,
    lastMetadataChangeAt,
    verificationResetCount: Number.isFinite(verificationResetCount)
      ? verificationResetCount
      : 0,
    hadDispute,
    lastDisputeResolvedAt,
    disputeOpenedAt,
    fuelType,
    bodyType,
    transmission,
    createdAt,
    updatedAt,
    records,
    uriHistory: parseUriHistory(obj.uriHistory),
  };
}

async function confirmStatusOnChain(
  tokenId: string,
  chainId: number,
  ponderStatus: PassportStatus,
): Promise<PassportStatus> {
  const address = karPassportAddress(chainId);
  if (!address) return ponderStatus;

  try {
    const client = getPublicClient(chainId);
    const result = await client.readContract({
      address,
      abi: KarPassportAbi,
      functionName: "getPassportStatus",
      args: [BigInt(tokenId)],
    });

    const chainStatus = passportStatusFromChainIndex(Number(result[0]));
    if (chainStatus && chainStatus !== ponderStatus) {
      return chainStatus;
    }
  } catch {
    /* keep ponder status */
  }

  return ponderStatus;
}

export async function fetchPassportDetail(
  tokenId: string,
  chainId: number,
): Promise<PassportDetailResult> {
  let raw: unknown;
  try {
    const res = await fetch(`${PONDER_URL}/passports/${tokenId}`, {
      next: { revalidate: 10 },
    });
    if (res.status === 404) return { ok: false, error: "NOT_FOUND" };
    if (!res.ok) return { ok: false, error: "PONDER_UNAVAILABLE" };
    raw = await res.json();
  } catch {
    return { ok: false, error: "PONDER_UNAVAILABLE" };
  }

  const parsed = parsePonderPassport(raw);
  if (!parsed) return { ok: false, error: "PONDER_UNAVAILABLE" };

  const status = await confirmStatusOnChain(tokenId, chainId, parsed.status);
  const passport: PonderPassportDetail = { ...parsed, status };

  if (!passport.tokenUri.trim()) {
    return { ok: true, passport, metadata: null, metadataError: true };
  }

  const metaResult = await fetchArweaveMetadata(passport.tokenUri, chainId);
  if (!metaResult.ok) {
    return { ok: true, passport, metadata: null, metadataError: true };
  }

  return { ok: true, passport, metadata: metaResult.metadata };
}

export async function fetchListingDetail(tokenId: string) {
  try {
    const res = await fetch(`${PONDER_URL}/listings/${tokenId}`, {
      next: { revalidate: 10 },
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export async function fetchVerifierDetail(address: string) {
  try {
    const res = await fetch(`${PONDER_URL}/verifiers/${address}`, {
      next: { revalidate: 30 },
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

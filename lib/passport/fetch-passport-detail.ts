import { cache } from "react";

import { consignmentToListingInput } from "@/lib/commerce/listing-view";
import { KarPassportAbi } from "@/lib/contracts/abis.generated";
import { mapPonderListingToRow } from "@/lib/marketplace/map-ponder-listing";
import { fetchChainPassportDetail, readTokenUriOnChain } from "@/lib/passport/build-chain-passport-detail";
import {
  effectiveTokenUri,
  hasTokenUriDrift,
  overlayPassportFromMetadata,
} from "@/lib/passport/passport-uri-drift";
import {
  fetchArweaveMetadata,
  type PassportMetadata,
} from "@/lib/passport/fetch-arweave-metadata";
import { passportStatusFromChainIndex } from "@/lib/passport/passport-status-chain";
import type {
  CustodyUnresolvedCause,
  PassportStatus,
  PonderPassportDetail,
  PonderUriHistoryEntry,
} from "@/lib/types/ponder";
import { karPassportAddress } from "@/lib/web3/deployment-addresses";
import {
  buildVerifierDetailUrl,
  fetchConsignmentByToken,
  fetchPassportByToken,
  ponderFetch,
} from "@/lib/web3/ponder-fetch";
import { getPublicClient } from "@/lib/web3/public-client";

export type PassportDetailResult =
  | {
      ok: true;
      passport: PonderPassportDetail;
      metadata: PassportMetadata | null;
      metadataError?: boolean;
      indexerPending?: boolean;
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

function parseChainIdField(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) return null;
  return n;
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

/** Exported for unit tests — fail-closed without custody answer. */
export function parsePonderPassport(raw: unknown): PonderPassportDetail | null {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;

  const id = typeof obj.id === "string" ? obj.id : "";
  const owner = typeof obj.owner === "string" ? obj.owner : "";
  const statusRaw = typeof obj.status === "string" ? obj.status : "";
  const chainId = parseChainIdField(obj.chainId);
  const custodyChainRaw = obj.custodyChain;
  const custodyChain =
    custodyChainRaw == null ? null : parseChainIdField(custodyChainRaw);
  const custodyUnresolved = parseCustodyUnresolved(obj.custodyUnresolved);
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
  const lastDisputeTerminal =
    typeof obj.lastDisputeTerminal === "string" ? obj.lastDisputeTerminal : "";
  const disputeOpenedAt =
    obj.disputeOpenedAt != null ? String(obj.disputeOpenedAt) : "0";
  const fuelType = typeof obj.fuelType === "string" ? obj.fuelType : "";
  const bodyType = typeof obj.bodyType === "string" ? obj.bodyType : "";
  const transmission = typeof obj.transmission === "string" ? obj.transmission : "";
  const createdAt = obj.createdAt != null ? String(obj.createdAt) : "0";
  const updatedAt = obj.updatedAt != null ? String(obj.updatedAt) : "0";

  const hasResolvedCustody = custodyChain != null && custodyUnresolved == null;
  const hasUnresolvedCustody =
    custodyChain == null && custodyUnresolved != null && custodyUnresolved !== undefined;

  if (
    !id ||
    !owner ||
    !isPassportStatus(statusRaw) ||
    chainId == null ||
    (!hasResolvedCustody && !hasUnresolvedCustody)
  ) {
    return null;
  }

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
    chainId,
    custodyChain: hasResolvedCustody ? custodyChain : null,
    custodyUnresolved: hasUnresolvedCustody ? custodyUnresolved : null,
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
    lastDisputeTerminal,
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

async function confirmOwnerOnChain(
  tokenId: string,
  chainId: number,
  ponderOwner: string,
): Promise<string> {
  const address = karPassportAddress(chainId);
  if (!address) return ponderOwner;

  try {
    const client = getPublicClient(chainId);
    const chainOwner = await client.readContract({
      address,
      abi: KarPassportAbi,
      functionName: "ownerOf",
      args: [BigInt(tokenId)],
    });

    if (
      typeof chainOwner === "string" &&
      chainOwner.toLowerCase() !== ponderOwner.toLowerCase()
    ) {
      return chainOwner;
    }
  } catch {
    /* keep ponder owner */
  }

  return ponderOwner;
}

export async function fetchPassportDetail(
  tokenId: string,
  /** Optional RPC hint for Ponder-miss only — never invent hub when absent. */
  chainId?: number | null,
  /**
   * Uncached Ponder GET for indexer catch-up polls (bridge / entity drift).
   * Page/RSC omit this — they use tagged `"use cache"`.
   */
  opts?: { live?: boolean },
): Promise<PassportDetailResult> {
  let raw: unknown;
  try {
    const res = await fetchPassportByToken(tokenId, opts);
    if (res.status === 404) {
      if (chainId == null) return { ok: false, error: "NOT_FOUND" };
      const chainResult = await fetchChainPassportDetail(tokenId, chainId);
      if (!chainResult.ok) return { ok: false, error: "NOT_FOUND" };
      return {
        ok: true,
        passport: chainResult.passport,
        metadata: chainResult.metadata,
        metadataError: chainResult.metadataError,
        indexerPending: true,
      };
    }
    if (!res.ok) return { ok: false, error: "PONDER_UNAVAILABLE" };
    raw = res.body;
  } catch {
    return { ok: false, error: "PONDER_UNAVAILABLE" };
  }

  const parsed = parsePonderPassport(raw);
  if (!parsed) return { ok: false, error: "PONDER_UNAVAILABLE" };

  // Commerce / drift confirms target custody, not origin or ?chain= hint.
  const rpcChainId = parsed.custodyChain ?? chainId ?? parsed.chainId;
  const ponderTokenUri = parsed.tokenUri.trim();
  const chainTokenUri = await readTokenUriOnChain(tokenId, rpcChainId);
  const uriDrift = hasTokenUriDrift(ponderTokenUri, chainTokenUri);
  const effectiveUri = effectiveTokenUri(ponderTokenUri, chainTokenUri);

  const [status, owner, metaResult] = await Promise.all([
    confirmStatusOnChain(tokenId, rpcChainId, parsed.status),
    confirmOwnerOnChain(tokenId, rpcChainId, parsed.owner),
    effectiveUri
      ? fetchArweaveMetadata(effectiveUri, rpcChainId)
      : Promise.resolve({ ok: false as const }),
  ]);

  let passport: PonderPassportDetail = { ...parsed, status, owner, tokenUri: effectiveUri };

  if (!effectiveUri) {
    return {
      ok: true,
      passport,
      metadata: null,
      metadataError: true,
      ...(uriDrift ? { indexerPending: true } : {}),
    };
  }

  if (!metaResult.ok) {
    return {
      ok: true,
      passport,
      metadata: null,
      metadataError: true,
      ...(uriDrift ? { indexerPending: true } : {}),
    };
  }

  if (uriDrift) {
    passport = overlayPassportFromMetadata(passport, metaResult.metadata, effectiveUri);
  }

  return {
    ok: true,
    passport,
    metadata: metaResult.metadata,
    ...(uriDrift ? { indexerPending: true } : {}),
  };
}

/** Per-request dedupe for generateMetadata + page render. */
export const fetchPassportDetailCached = cache(fetchPassportDetail);

export type FixedPriceListingDetailProp = {
  active: boolean;
  seller: `0x${string}`;
  price: string;
  denominationKind: number;
  asset: string;
  currencyCode: string;
  fiatCurrency: number;
  /** Fiat 1e8 when Fiat; "0" for asset. */
  fiatPrice1e8: string;
  agent?: string;
  returnRequestedAt?: string | number;
  externalPaymentConfirmedAt?: string | number;
};

/**
 * Live fixed-price consignment for passport/marketplace detail (Ponder).
 * Prefer `/consignments/by-token` — legacy `/listings/:id` is retired.
 */
export async function fetchListingDetail(
  tokenId: string,
  chainId?: number,
): Promise<FixedPriceListingDetailProp | null> {
  try {
    const lot = await fetchConsignmentByToken(tokenId, {
      mode: "fixedPrice",
      chainId:
        chainId != null && Number.isFinite(chainId) && chainId > 0
          ? Math.trunc(chainId)
          : undefined,
    });
    if (!lot.ok || lot.consignment == null) return null;
    const row = lot.consignment;
    const input = consignmentToListingInput(row);
    const mapped = mapPonderListingToRow(input);
    const active =
      row.phase === "offered" || row.phase === "binding";
    return {
      active,
      seller: mapped.seller,
      price: mapped.price,
      denominationKind: mapped.denominationKind,
      asset: mapped.asset,
      currencyCode:
        typeof row.currencyCode === "string" ? row.currencyCode : "",
      fiatCurrency: mapped.fiatCurrency,
      fiatPrice1e8: mapped.fiatPrice1e8,
      agent: mapped.agent ?? undefined,
      returnRequestedAt: mapped.returnRequestedAt ?? undefined,
      externalPaymentConfirmedAt:
        mapped.externalPaymentConfirmedAt ?? undefined,
    };
  } catch {
    return null;
  }
}

/** Build Ponder verifier detail URL; prefer `?chainId=` (SPEC §I.12.12). */
export function buildVerifierDetailQueryUrl(
  address: string,
  chainId?: number,
): string {
  return buildVerifierDetailUrl(
    address,
    chainId != null && Number.isFinite(chainId) && chainId > 0
      ? Math.trunc(chainId)
      : undefined,
  );
}

export async function fetchVerifierDetail(
  address: string,
  chainId?: number,
) {
  try {
    const res = await ponderFetch(
      "verifiers",
      buildVerifierDetailQueryUrl(address, chainId),
    );
    if (!res.ok) return null;
    return res.body;
  } catch {
    return null;
  }
}

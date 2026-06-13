import { KarPassportAbi } from "@/lib/contracts/abis.generated";
import {
  fetchArweaveMetadata,
  type PassportMetadata,
} from "@/lib/passport/fetch-arweave-metadata";
import type {
  PassportStatus,
  PonderPassportDetail,
} from "@/lib/types/ponder";
import { karPassportAddress } from "@/lib/web3/deployment-addresses";
import { getPublicClient } from "@/lib/web3/public-client";

const PONDER_URL =
  process.env.PONDER_SQL_API_URL ?? "http://localhost:42069";

const STATUS_FROM_CHAIN: Record<number, PassportStatus> = {
  0: "UNVERIFIED",
  1: "VERIFIED",
  2: "DISPUTED",
};

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

function parsePonderPassport(raw: unknown): PonderPassportDetail | null {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;

  const id = typeof obj.id === "string" ? obj.id : "";
  const owner = typeof obj.owner === "string" ? obj.owner : "";
  const statusRaw = typeof obj.status === "string" ? obj.status : "";
  const verifier = typeof obj.verifier === "string" ? obj.verifier : "";
  const verifiedAt = obj.verifiedAt != null ? String(obj.verifiedAt) : "0";
  const tokenUri = typeof obj.tokenUri === "string" ? obj.tokenUri : "";
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
    createdAt,
    updatedAt,
    records,
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

    const chainStatus = STATUS_FROM_CHAIN[Number(result[0])];
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

  const metaResult = await fetchArweaveMetadata(passport.tokenUri);
  if (!metaResult.ok) {
    return { ok: true, passport, metadata: null, metadataError: true };
  }

  return { ok: true, passport, metadata: metaResult.metadata };
}

import { KarPassportAbi } from "@/lib/contracts/abis.generated";
import type { PassportMetadata } from "@/lib/passport/fetch-arweave-metadata";
import { fetchArweaveMetadata } from "@/lib/passport/fetch-arweave-metadata";
import { passportStatusFromChainIndex } from "@/lib/passport/passport-status-chain";
import type { PassportStatus, PonderPassportDetail } from "@/lib/types/ponder";
import { karPassportAddress } from "@/lib/web3/deployment-addresses";
import { getPublicClient } from "@/lib/web3/public-client";

export type ChainPassportDetailResult =
  | {
      ok: true;
      passport: PonderPassportDetail;
      metadata: PassportMetadata | null;
      metadataError?: boolean;
    }
  | { ok: false };

export function buildChainPassportStub(
  tokenId: string,
  owner: string,
  tokenUri: string,
  status: PassportStatus,
  metadata: PassportMetadata | null,
  chainId: number,
): PonderPassportDetail {
  return {
    id: tokenId,
    chainId,
    custodyChain: chainId,
    owner,
    status,
    verifier: "",
    verifiedAt: "0",
    tokenUri,
    vin: metadata?.vin ?? "",
    make: metadata?.make ?? "",
    model: metadata?.model ?? "",
    year: metadata?.year ?? 0,
    mileageKm: metadata?.mileageKm ?? 0,
    lastDisputer: "",
    disputeReason: "",
    disputeWithdrawnAt: "0",
    lastVerificationResetAt: "0",
    duplicateVin: false,
    lastMetadataChangeAt: "0",
    verificationResetCount: 0,
    hadDispute: false,
    lastDisputeResolvedAt: "0",
    disputeOpenedAt: "0",
    fuelType: metadata?.fuelType ?? "",
    bodyType: metadata?.bodyType ?? "",
    transmission: metadata?.transmission ?? "",
    createdAt: "0",
    updatedAt: "0",
    records: [],
    uriHistory: [],
  };
}

export async function readTokenUriOnChain(
  tokenId: string,
  chainId: number,
): Promise<string | null> {
  const address = karPassportAddress(chainId);
  if (!address) return null;

  try {
    const client = getPublicClient(chainId);
    const uri = await client.readContract({
      address,
      abi: KarPassportAbi,
      functionName: "tokenURI",
      args: [BigInt(tokenId)],
    });
    return typeof uri === "string" ? uri : null;
  } catch {
    return null;
  }
}

export async function fetchChainPassportDetail(
  tokenId: string,
  chainId: number,
): Promise<ChainPassportDetailResult> {
  const address = karPassportAddress(chainId);
  if (!address) return { ok: false };

  const client = getPublicClient(chainId);
  const tokenIdBigInt = BigInt(tokenId);

  let owner: string;
  try {
    const chainOwner = await client.readContract({
      address,
      abi: KarPassportAbi,
      functionName: "ownerOf",
      args: [tokenIdBigInt],
    });
    if (typeof chainOwner !== "string") return { ok: false };
    owner = chainOwner;
  } catch {
    return { ok: false };
  }

  let tokenUri = "";
  let status: PassportStatus = "UNVERIFIED";
  try {
    const [uri, statusResult] = await Promise.all([
      readTokenUriOnChain(tokenId, chainId),
      client.readContract({
        address,
        abi: KarPassportAbi,
        functionName: "getPassportStatus",
        args: [tokenIdBigInt],
      }),
    ]);
    tokenUri = uri ?? "";
    const chainStatus = passportStatusFromChainIndex(Number(statusResult[0]));
    if (chainStatus) status = chainStatus;
  } catch {
    /* owner exists; use defaults for uri/status */
  }

  const trimmedUri = tokenUri.trim();
  const metaResult = trimmedUri
    ? await fetchArweaveMetadata(trimmedUri, chainId)
    : { ok: false as const };

  const metadata = metaResult.ok ? metaResult.metadata : null;
  const passport = buildChainPassportStub(
    tokenId,
    owner,
    trimmedUri,
    status,
    metadata,
    chainId,
  );

  if (!trimmedUri) {
    return { ok: true, passport, metadata: null, metadataError: true };
  }
  if (!metaResult.ok) {
    return { ok: true, passport, metadata: null, metadataError: true };
  }
  return { ok: true, passport, metadata };
}

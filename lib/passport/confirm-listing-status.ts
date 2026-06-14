import { passportStatusFromChainIndex } from "@/lib/passport/passport-status-chain";
import type { PassportStatus } from "@/lib/types/ponder";

export { passportStatusFromChainIndex, STATUS_FROM_CHAIN } from "@/lib/passport/passport-status-chain";

export const LISTING_CHAIN_STATUS_BATCH_CAP = 12;

export type ListingStatusKey = `${number}:${string}`;

export function listingStatusKey(chainId: number, tokenId: string): ListingStatusKey {
  return `${chainId}:${tokenId}`;
}

export type ListingChainStatusDrift = {
  ponderStatus: PassportStatus;
  chainStatus: PassportStatus;
};

export function compareListingStatus(
  ponderStatus: PassportStatus,
  chainStatus: PassportStatus | null,
): ListingChainStatusDrift | null {
  if (!chainStatus || chainStatus === ponderStatus) return null;
  return { ponderStatus, chainStatus };
}

export function pickListingsForChainConfirm<T extends { chainId: number; tokenId: string }>(
  rows: readonly T[],
  cap = LISTING_CHAIN_STATUS_BATCH_CAP,
): T[] {
  return rows.slice(0, cap);
}

export function chainStatusFromGetPassportStatusResult(
  result: readonly [status: bigint | number, verifier: string, verifiedAt: bigint | number],
): PassportStatus | null {
  return passportStatusFromChainIndex(Number(result[0]));
}

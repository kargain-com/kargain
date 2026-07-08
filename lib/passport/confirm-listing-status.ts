import { passportStatusFromChainIndex } from "@/lib/passport/passport-status-chain";
import type { PassportStatus } from "@/lib/types/ponder";

export { passportStatusFromChainIndex, STATUS_FROM_CHAIN } from "@/lib/passport/passport-status-chain";

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

export function chainStatusFromGetPassportStatusResult(
  result: readonly [status: bigint | number, verifier: string, verifiedAt: bigint | number],
): PassportStatus | null {
  return passportStatusFromChainIndex(Number(result[0]));
}

"use client";

import { CircleWarningIcon } from "@/components/ui/icons";

import { usePassportChainStatus } from "@/hooks/use-passport-chain-status";
import { compareListingStatus } from "@/lib/passport/confirm-listing-status";
import type { PassportStatus } from "@/lib/types/ponder";
import { cn } from "@/lib/utils";

const STATUS_LABEL: Record<PassportStatus, string> = {
  UNVERIFIED: "Unverified",
  VERIFIED: "Verified",
  DISPUTED: "Disputed",
};

type Props = {
  tokenId: string | number;
  ponderStatus: PassportStatus;
  chainId: number;
  className?: string;
};

export function PassportChainStatusBanner({
  tokenId,
  ponderStatus,
  chainId,
  className,
}: Props) {
  const { chainStatus, isLoading, isFetching, isError } = usePassportChainStatus(
    chainId,
    String(tokenId),
    ponderStatus,
  );

  if (isLoading || isFetching || isError || !chainStatus) {
    return null;
  }

  const drift = compareListingStatus(ponderStatus, chainStatus);
  if (!drift) {
    return null;
  }

  return (
    <div
      className={cn(
        "flex gap-3 rounded-md border border-status-error/40 bg-bg-card p-4",
        className,
      )}
      role="status"
    >
      <div className="shrink-0 text-status-error mt-0.5">
        <CircleWarningIcon size={20} aria-hidden />
      </div>
      <div className="flex flex-col gap-1">
        <p className="font-sans text-sm font-medium text-text-primary">
          On-chain status differs from index
        </p>
        <p className="font-sans text-sm text-text-secondary">
          On-chain: {STATUS_LABEL[drift.chainStatus]} · Indexed:{" "}
          {STATUS_LABEL[drift.ponderStatus]}. The on-chain value is authoritative.
        </p>
      </div>
    </div>
  );
}

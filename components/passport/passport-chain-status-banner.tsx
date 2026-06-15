"use client";

import { AlertCircle } from "lucide-react";
import { useReadContract } from "wagmi";

import { KarPassportAbi } from "@/lib/contracts/abis.generated";
import {
  chainStatusFromGetPassportStatusResult,
  compareListingStatus,
} from "@/lib/passport/confirm-listing-status";
import type { PassportStatus } from "@/lib/types/ponder";
import { karPassportAddress } from "@/lib/web3/deployment-addresses";
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
  const address = karPassportAddress(chainId);

  const { data, isLoading, isFetching, isError } = useReadContract({
    address,
    abi: KarPassportAbi,
    functionName: "getPassportStatus",
    args: [BigInt(tokenId)],
    chainId,
    query: { enabled: Boolean(address) },
  });

  if (isLoading || isFetching || isError || !data) {
    return null;
  }

  const chainStatus = chainStatusFromGetPassportStatusResult(data);
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
        <AlertCircle size={20} strokeWidth={1.5} aria-hidden />
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

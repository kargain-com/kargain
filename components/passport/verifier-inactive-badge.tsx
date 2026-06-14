"use client";

import { useReadContracts } from "wagmi";

import { KarProStakingAbi } from "@/lib/contracts/abis.generated";
import { karProStakingAddress } from "@/lib/web3/deployment-addresses";

const ZERO = "0x0000000000000000000000000000000000000000";

type Props = {
  chainId: number;
  verifier: string;
  className?: string;
};

export function VerifierInactiveBadge({ chainId, verifier, className }: Props) {
  const normalized = verifier.trim().toLowerCase();
  const staking = karProStakingAddress(chainId);
  const hasVerifier = normalized && normalized !== ZERO;

  const { data } = useReadContracts({
    contracts:
      staking && hasVerifier
        ? [
            {
              address: staking,
              abi: KarProStakingAbi,
              functionName: "isActiveVerifier",
              args: [verifier as `0x${string}`],
            },
          ]
        : [],
  });

  const isActive = data?.[0]?.result === true;
  if (!hasVerifier || isActive || data?.[0]?.result === undefined) {
    return null;
  }

  return (
    <span
      className={
        className ??
        "inline-flex rounded border border-status-error/40 bg-bg-primary/80 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-status-error"
      }
    >
      Verifier inactive
    </span>
  );
}

/** Inline variant for detail sidebar — shows badge only when inactive. */
export function VerifierInactiveInline({ chainId, verifier }: Props) {
  return (
    <VerifierInactiveBadge
      chainId={chainId}
      verifier={verifier}
      className="ml-2 inline-flex align-middle"
    />
  );
}

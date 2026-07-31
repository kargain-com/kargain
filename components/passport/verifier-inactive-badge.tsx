"use client";

import { KarProStakingAbi } from "@/lib/contracts/abis.generated";
import { karProStakingAddress } from "@/lib/web3/deployment-addresses";
import { useKeyedReadContracts } from "@/lib/web3/keyed-multicall";

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

  const reads = useKeyedReadContracts({
    contracts:
      staking && hasVerifier
        ? [
            {
              key: "isActiveVerifier" as const,
              address: staking,
              abi: KarProStakingAbi,
              functionName: "isActiveVerifier",
              args: [verifier as `0x${string}`],
              chainId,
            },
          ]
        : [],
  });

  const activeRaw = reads.get("isActiveVerifier");
  const isActive = activeRaw === true;
  if (!hasVerifier || isActive || activeRaw === undefined) {
    return null;
  }

  return (
    <span
      className={
        className ??
        "inline-flex items-center px-2.5 py-1 rounded-full bg-bg-surface border border-status-error/40 font-mono text-xs font-medium tracking-[0.18em] uppercase text-status-error"
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

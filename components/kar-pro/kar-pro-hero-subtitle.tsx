"use client";

import { formatEther } from "viem";
import { useReadContract } from "wagmi";

import { KarProStakingAbi } from "@/lib/contracts/abis.generated";
import { karProStakingAddress } from "@/lib/web3/deployment-addresses";
import { DEFAULT_CHAIN_ID } from "@/lib/web3/supported-chains";

function formatStakeEth(wei: bigint | undefined): string {
  if (wei === undefined) return "0.05";
  const formatted = formatEther(wei);
  const num = Number.parseFloat(formatted);
  return Number.isFinite(num) ? num.toFixed(2) : formatted;
}

export function KarProHeroSubtitle() {
  const chainId = DEFAULT_CHAIN_ID;
  const staking = karProStakingAddress(chainId);

  const { data: minStake, isPending: minStakePending } = useReadContract({
    address: staking,
    abi: KarProStakingAbi,
    functionName: "minStakeNative",
    query: { enabled: Boolean(staking) },
  });

  const stakeLabel = formatStakeEth(minStake);

  return (
    <p className="font-sans text-fluid-body-lg font-normal leading-[1.55] text-text-secondary mt-4">
      Become a trusted verifier. Stake{" "}
      {minStakePending ? (
        <span
          className="inline-block h-4 w-16 animate-pulse rounded-sm bg-bg-surface align-baseline"
          aria-hidden
        />
      ) : (
        `${stakeLabel} ETH`
      )}
      , build your reputation, help buyers trust sellers.
    </p>
  );
}

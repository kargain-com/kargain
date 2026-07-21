"use client";

import { useReadContract } from "wagmi";

import { KarProStakingAbi } from "@/lib/contracts/abis.generated";
import { formatStakeEth } from "@/lib/kar-pro/stake-format";
import { karProStakingAddress } from "@/lib/web3/deployment-addresses";
import { wagmiChainId } from "@/lib/web3/supported-chains";

/** When `chainId` is undefined, stake reads are disabled (non-commercial wallet). */
export function useMinStakeNative(chainId: number | undefined) {
  const staking = chainId != null ? karProStakingAddress(chainId) : undefined;
  const wc = chainId != null ? wagmiChainId(chainId) : undefined;

  const { data: minStake, isPending } = useReadContract({
    address: staking,
    abi: KarProStakingAbi,
    functionName: "minStakeNative",
    chainId: wc,
    query: { enabled: Boolean(staking && chainId != null) },
  });

  return {
    minStake,
    stakeLabel: formatStakeEth(minStake),
    isPending: Boolean(staking) && isPending,
  };
}

"use client";

import { useReadContract } from "wagmi";

import { KarProStakingAbi } from "@/lib/contracts/abis.generated";
import { formatStakeEth } from "@/lib/kar-pro/stake-format";
import { karProStakingAddress } from "@/lib/web3/deployment-addresses";
import { DEFAULT_CHAIN_ID } from "@/lib/web3/supported-chains";

export function useMinStakeNative() {
  const chainId = DEFAULT_CHAIN_ID;
  const staking = karProStakingAddress(chainId);

  const { data: minStake, isPending } = useReadContract({
    address: staking,
    abi: KarProStakingAbi,
    functionName: "minStakeNative",
    query: { enabled: Boolean(staking) },
  });

  return {
    minStake,
    stakeLabel: formatStakeEth(minStake),
    isPending: Boolean(staking) && isPending,
  };
}

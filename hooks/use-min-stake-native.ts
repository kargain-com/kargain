"use client";

import { useReadContract } from "wagmi";

import { KarProStakingAbi } from "@/lib/contracts/abis.generated";
import { formatStakeNative } from "@/lib/kar-pro/stake-format";
import {
  commercialActive,
  nativeUnitOf,
} from "@/lib/web3/commercial-active";
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

  const stack = chainId != null ? commercialActive(chainId) : undefined;
  const stakeLabel =
    stack != null
      ? formatStakeNative(minStake, nativeUnitOf(stack))
      : "0.05";

  return {
    minStake,
    stakeLabel,
    isPending: Boolean(staking) && isPending,
  };
}

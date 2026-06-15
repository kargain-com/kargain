"use client";

import { useAccount, useReadContract } from "wagmi";

import { KarProStakingAbi } from "@/lib/contracts/abis.generated";
import { karProStakingAddress } from "@/lib/web3/deployment-addresses";
import { DEFAULT_CHAIN_ID } from "@/lib/web3/supported-chains";

export function useShowBecomeKarPro(): boolean {
  const { address, isConnected } = useAccount();
  const staking = karProStakingAddress(DEFAULT_CHAIN_ID);
  const { data: isActiveVerifier } = useReadContract({
    address: staking,
    abi: KarProStakingAbi,
    functionName: "isActiveVerifier",
    args: address ? [address] : undefined,
    query: { enabled: Boolean(isConnected && staking && address) },
  });

  return isConnected && isActiveVerifier !== true;
}

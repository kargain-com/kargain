"use client";

import { useReadContract } from "wagmi";

import { KarPassportAbi } from "@/lib/contracts/abis.generated";
import { karPassportAddress } from "@/lib/web3/deployment-addresses";
import { wagmiChainId } from "@/lib/web3/supported-chains";

export function usePassportOnChainOwner(chainId: number, tokenId: string) {
  const passport = karPassportAddress(chainId);
  const wc = wagmiChainId(chainId);

  const { data, isLoading } = useReadContract({
    address: passport,
    abi: KarPassportAbi,
    functionName: "ownerOf",
    args: [BigInt(tokenId)],
    chainId: wc,
    query: {
      enabled: Boolean(passport && tokenId),
    },
  });

  const onChainOwner = data as `0x${string}` | undefined;

  return { onChainOwner, isLoading };
}

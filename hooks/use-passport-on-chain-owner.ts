"use client";

import { useReadContract } from "wagmi";

import { KarPassportAbi } from "@/lib/contracts/abis.generated";
import { karPassportAddress } from "@/lib/web3/deployment-addresses";
import { eip155WagmiChainId } from "@/lib/web3/supported-chains";

export function usePassportOnChainOwner(chainId: number, tokenId: string) {
  const passport = karPassportAddress(chainId);
  const wc = eip155WagmiChainId(chainId);

  const { data, isLoading } = useReadContract({
    address: passport,
    abi: KarPassportAbi,
    functionName: "ownerOf",
    args: [BigInt(tokenId)],
    chainId: wc,
    query: {
      enabled: Boolean(wc != null && passport && tokenId),
    },
  });

  const onChainOwner = data as `0x${string}` | undefined;

  return { onChainOwner, isLoading };
}

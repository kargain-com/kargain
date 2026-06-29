"use client";

import { useEffect } from "react";
import { useReadContract } from "wagmi";

import { KarPassportAbi } from "@/lib/contracts/abis.generated";
import { chainStatusFromGetPassportStatusResult } from "@/lib/passport/confirm-listing-status";
import type { PassportStatus } from "@/lib/types/ponder";
import { karPassportAddress } from "@/lib/web3/deployment-addresses";
import { wagmiChainId } from "@/lib/web3/supported-chains";

export function usePassportChainStatus(
  chainId: number,
  tokenId: string,
  ponderStatus: PassportStatus,
) {
  const address = karPassportAddress(chainId);
  const wc = wagmiChainId(chainId);

  const { data, isLoading, isFetching, isError, refetch } = useReadContract({
    address,
    abi: KarPassportAbi,
    functionName: "getPassportStatus",
    args: [BigInt(tokenId)],
    chainId: wc,
    query: { enabled: Boolean(address) },
  });

  useEffect(() => {
    void refetch();
  }, [ponderStatus, refetch]);

  const chainStatus = data ? chainStatusFromGetPassportStatusResult(data) : null;

  return { chainStatus, isLoading, isFetching, isError };
}

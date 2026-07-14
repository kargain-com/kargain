"use client";

import { useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useReadContracts } from "wagmi";

import {
  parseOnChainAuction,
  parseOnChainHold,
  type OnChainAuction,
  type OnChainHold,
} from "@/lib/auction/parse-on-chain-auction";
import { AuctionEscrowAbi } from "@/lib/contracts/abis.generated";
import { auctionEscrowAddress } from "@/lib/web3/deployment-addresses";
import { wagmiChainId } from "@/lib/web3/supported-chains";

const STALE_MS = 30_000;
const CONFIG_STALE_MS = 300_000;

export const auctionChainQueryKey = (chainId: number, tokenId: string) =>
  ["auction-chain", chainId, tokenId] as const;

type UseAuctionChainReadsArgs = {
  chainId: number;
  tokenId: string;
  enabled?: boolean;
};

export function useAuctionChainReads({
  chainId,
  tokenId,
  enabled = true,
}: UseAuctionChainReadsArgs) {
  const escrow = auctionEscrowAddress(chainId);
  const wc = wagmiChainId(chainId);
  const tokenIdBig = useMemo(() => {
    try {
      return BigInt(tokenId);
    } catch {
      return 0n;
    }
  }, [tokenId]);

  const readsEnabled = Boolean(enabled && escrow && tokenId);

  const { data, isPending, isFetching, refetch } = useReadContracts({
    contracts: readsEnabled
      ? [
          {
            address: escrow!,
            abi: AuctionEscrowAbi,
            functionName: "auctions" as const,
            args: [tokenIdBig] as const,
            chainId: wc,
          },
          {
            address: escrow!,
            abi: AuctionEscrowAbi,
            functionName: "holds" as const,
            args: [tokenIdBig] as const,
            chainId: wc,
          },
          {
            address: escrow!,
            abi: AuctionEscrowAbi,
            functionName: "minIncrementBps" as const,
            chainId: wc,
          },
          {
            address: escrow!,
            abi: AuctionEscrowAbi,
            functionName: "extensionWindow" as const,
            chainId: wc,
          },
          {
            address: escrow!,
            abi: AuctionEscrowAbi,
            functionName: "paused" as const,
            chainId: wc,
          },
          {
            address: escrow!,
            abi: AuctionEscrowAbi,
            functionName: "returnRequestedAt" as const,
            args: [tokenIdBig] as const,
            chainId: wc,
          },
        ]
      : [],
    query: {
      enabled: readsEnabled,
      staleTime: STALE_MS,
      // Config values (minIncrementBps, extensionWindow) are effectively immutable;
      // overall batch still shares staleTime ≥ 30s per budget.
      gcTime: CONFIG_STALE_MS,
    },
  });

  const auction: OnChainAuction | null =
    data?.[0]?.status === "success"
      ? parseOnChainAuction(data[0].result)
      : null;

  const hold: OnChainHold | null =
    data?.[1]?.status === "success" ? parseOnChainHold(data[1].result) : null;

  const minIncrementBps =
    data?.[2]?.status === "success" ? Number(data[2].result) : undefined;

  const extensionWindow =
    data?.[3]?.status === "success"
      ? BigInt(data[3].result as number | bigint)
      : undefined;

  const paused =
    data?.[4]?.status === "success" ? Boolean(data[4].result) : undefined;

  const returnRequestedAt =
    data?.[5]?.status === "success"
      ? BigInt(data[5].result as number | bigint)
      : undefined;

  const queryClient = useQueryClient();

  const invalidateAfterTx = () => {
    void refetch();
    void queryClient.invalidateQueries({
      queryKey: auctionChainQueryKey(chainId, tokenId),
    });
  };

  return {
    escrow,
    auction,
    hold,
    minIncrementBps,
    extensionWindow,
    paused,
    returnRequestedAt,
    isPending: readsEnabled && isPending,
    isFetching,
    refetch,
    invalidateAfterTx,
  };
}

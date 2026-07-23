"use client";

import { useMemo } from "react";
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
          {
            address: escrow!,
            abi: AuctionEscrowAbi,
            functionName: "settlementDisputeBond" as const,
            chainId: wc,
          },
          {
            address: escrow!,
            abi: AuctionEscrowAbi,
            functionName: "settlementHold" as const,
            chainId: wc,
          },
          {
            address: escrow!,
            abi: AuctionEscrowAbi,
            functionName: "disputeResolutionTimeout" as const,
            chainId: wc,
          },
        ]
      : [],
    query: {
      enabled: readsEnabled,
      staleTime: STALE_MS,
      // Config values (minIncrementBps, extensionWindow, settlement*) are
      // effectively immutable; overall batch still shares staleTime ≥ 30s.
      gcTime: CONFIG_STALE_MS,
    },
  });

  const auction: OnChainAuction | null =
    data?.[0]?.status === "success"
      ? parseOnChainAuction(data[0].result)
      : null;

  const hold: OnChainHold | null =
    data?.[1]?.status === "success" ? parseOnChainHold(data[1].result) : null;
  const commerceReadResolved =
    data?.[0]?.status === "success" && data?.[1]?.status === "success";

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

  const settlementDisputeBond =
    data?.[6]?.status === "success"
      ? BigInt(data[6].result as number | bigint)
      : undefined;

  const settlementHold =
    data?.[7]?.status === "success"
      ? BigInt(data[7].result as number | bigint)
      : undefined;

  const disputeResolutionTimeout =
    data?.[8]?.status === "success"
      ? BigInt(data[8].result as number | bigint)
      : undefined;

  return {
    escrow,
    auction,
    hold,
    minIncrementBps,
    extensionWindow,
    paused,
    returnRequestedAt,
    settlementDisputeBond,
    settlementHold,
    disputeResolutionTimeout,
    commerceReadResolved,
    isPending: readsEnabled && isPending,
    isFetching,
    refetch,
  };
}

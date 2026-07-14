"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { getAuctionBids } from "@/app/actions/auction-detail";
import {
  filterBidsForAuction,
  isLiveAuctionUiState,
  type AuctionBid,
  type AuctionUiState,
} from "@/lib/auction/map-ponder-auction";
import { useDocumentVisible } from "@/hooks/use-document-visible";

type Args = {
  tokenId: string;
  auctionCreatedAt: bigint;
  uiState: AuctionUiState;
  enabled?: boolean;
  pageSize?: number;
};

export function useAuctionBids({
  tokenId,
  auctionCreatedAt,
  uiState,
  enabled = true,
  pageSize = 50,
}: Args) {
  const visible = useDocumentVisible();
  const liveGate = isLiveAuctionUiState(uiState) && visible;

  const query = useInfiniteQuery({
    queryKey: ["auction-bids", tokenId, String(auctionCreatedAt)],
    queryFn: async ({ pageParam }) => {
      const result = await getAuctionBids(tokenId, {
        page: pageParam,
        limit: pageSize,
        auctionCreatedAt,
      });
      return result;
    },
    initialPageParam: 1,
    getNextPageParam: (last) => {
      if (last.page >= last.totalPages) return undefined;
      return last.page + 1;
    },
    enabled: enabled && Boolean(tokenId),
    staleTime: 7_000,
    refetchInterval: liveGate ? 7_000 : false,
    refetchIntervalInBackground: false,
  });

  const bids: AuctionBid[] = useMemo(() => {
    const all = query.data?.pages.flatMap((p) => p.bids) ?? [];
    // Defense in depth — action already filters, re-apply U11
    return filterBidsForAuction(all, auctionCreatedAt);
  }, [query.data, auctionCreatedAt]);

  return {
    bids,
    isPending: query.isPending,
    isFetching: query.isFetching,
    hasNextPage: query.hasNextPage,
    fetchNextPage: query.fetchNextPage,
    refetch: query.refetch,
    ponderError: query.data?.pages[0]?.ponderError,
  };
}

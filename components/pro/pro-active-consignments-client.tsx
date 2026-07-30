"use client";

import { useEffect, useMemo, useRef } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useInView } from "framer-motion";
import type { Address } from "viem";

import { getConsignments } from "@/app/actions/commerce-consignments";
import { ListingCard } from "@/components/marketplace/listing-card";
import { ListingCardSkeleton } from "@/components/marketplace/listing-card-skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { consignmentRecordToListingInput } from "@/lib/commerce/listing-view";
import { LISTING_CARD_GRID_PRO } from "@/lib/marketplace/listing-card-grid";
import { mapPonderListingToRow } from "@/lib/marketplace/map-ponder-listing";

const PAGE_SIZE = 20;

export function ProActiveConsignmentsClient({
  address,
}: {
  address: Address;
}) {
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const inView = useInView(loadMoreRef, { margin: "200px" });

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isPending,
    isError,
  } = useInfiniteQuery({
    queryKey: ["pro-active-consignments", address],
    queryFn: async ({ pageParam }) => {
      return getConsignments({
        agent: address,
        live: true,
        page: pageParam as number,
        limit: PAGE_SIZE,
      });
    },
    initialPageParam: 1,
    getNextPageParam: (last) => {
      if (last.ponderError) return undefined;
      if (last.page < last.totalPages) return last.page + 1;
      return undefined;
    },
  });

  const rows = useMemo(() => {
    const consignments = data?.pages.flatMap((page) => page.rows) ?? [];
    return consignments.map((row) =>
      mapPonderListingToRow(consignmentRecordToListingInput(row)),
    );
  }, [data]);

  const ponderError = data?.pages[0]?.ponderError;

  useEffect(() => {
    if (inView && hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [inView, hasNextPage, isFetchingNextPage, fetchNextPage]);

  if (ponderError) {
    return (
      <EmptyState
        variant="infrastructure"
        level="B"
        title="Indexer unavailable"
        description="Active consignments could not be loaded right now."
        role="alert"
      />
    );
  }

  if (isPending) {
    return (
      <ul className={LISTING_CARD_GRID_PRO}>
        {Array.from({ length: 6 }).map((_, i) => (
          <li key={i}>
            <ListingCardSkeleton />
          </li>
        ))}
      </ul>
    );
  }

  if (isError) {
    return (
      <EmptyState
        variant="infrastructure"
        level="B"
        title="Could not load consignments"
        description="Try again in a moment."
      />
    );
  }

  if (rows.length === 0) {
    return (
      <EmptyState variant="content" level="B" title="No active consignments." />
    );
  }

  return (
    <>
      <ul className={LISTING_CARD_GRID_PRO}>
        {rows.map((row) => (
          <li key={row.tokenId}>
            <ListingCard row={row} />
          </li>
        ))}
      </ul>
      <div ref={loadMoreRef} className="h-1" aria-hidden />
      {isFetchingNextPage ? (
        <ul className={`${LISTING_CARD_GRID_PRO} mt-6`}>
          {Array.from({ length: 3 }).map((_, i) => (
            <li key={i}>
              <ListingCardSkeleton />
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}

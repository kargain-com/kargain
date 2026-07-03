"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { useInView } from "framer-motion";
import { AlertTriangle } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";

import {
  searchMarketplaceListings,
  type MarketplaceListingRow,
  type MarketplaceListingsResult,
} from "@/app/actions/marketplace-listings";
import { ListingCard } from "@/components/marketplace/listing-card";
import { ListingCardSkeleton } from "@/components/marketplace/listing-card-skeleton";
import { MarketFilterBar } from "@/components/marketplace/market-filter-bar";
import { MarketFilterChips } from "@/components/marketplace/market-filter-chips";
import { EmptyState } from "@/components/ui/empty-state";
import { FadeUp } from "@/components/ui/fade-up";
import { useDeferListingChainStatusConfirm } from "@/hooks/use-defer-listing-chain-status-confirm";
import { useListingChainStatusConfirm } from "@/hooks/use-listing-chain-status-confirm";
import { useMarketRatesRequest } from "@/hooks/use-market-rates-request";
import { useMarketFiltersFromUrl } from "@/hooks/use-market-filters";
import { useDisplayCurrency } from "@/lib/marketplace/display-currency-context";
import {
  rateRequiredForPriceCurrency,
  ratesReadyForPriceCurrency,
} from "@/lib/marketplace/price-normalize";
import { marketFiltersToApiInput } from "@/lib/marketplace/filter-params";
import { pickPartialFxRates } from "@/lib/marketplace/fx-rate-registry";
import { marketplaceListingsNeedClientRates } from "@/lib/marketplace/listings-prefetch";
import { shouldEnableListingChainStatusConfirm } from "@/lib/marketplace/listing-chain-status-confirm-fetch";
import { listingStatusKey } from "@/lib/passport/confirm-listing-status";

type MarketBrowseProps = {
  initialListingsPage?: MarketplaceListingsResult;
};

export function MarketBrowse({ initialListingsPage }: MarketBrowseProps) {
  const filters = useMarketFiltersFromUrl();
  useMarketRatesRequest(marketplaceListingsNeedClientRates(filters));
  const fxContext = useDisplayCurrency();
  const filterRates = pickPartialFxRates(fxContext);

  const needsRates = marketplaceListingsNeedClientRates(filters);
  const hasPriceFilter = Boolean(filters.priceMin.trim() || filters.priceMax.trim());
  const effectivePriceCurrency = filters.priceCurrency || "USD";
  const needsRatesForFilter =
    hasPriceFilter && rateRequiredForPriceCurrency(effectivePriceCurrency);
  const needsRatesForSort =
    filters.sort === "price_asc" || filters.sort === "price_desc";

  const ratesReadyForFilter =
    !needsRatesForFilter ||
    ratesReadyForPriceCurrency(effectivePriceCurrency, filterRates);
  const ratesReadyForSort = !needsRatesForSort || (filterRates.ethUsd != null && filterRates.eurUsd != null);
  const ratesReady = ratesReadyForFilter && ratesReadyForSort;

  const apiInput = useMemo(
    () => marketFiltersToApiInput(filters, needsRates ? filterRates : undefined),
    [filters, filterRates, needsRates],
  );
  const queryKey = useMemo(() => JSON.stringify(apiInput), [apiInput]);

  const prefetchedQueryKey = useMemo(
    () => JSON.stringify(marketFiltersToApiInput(filters)),
    [filters],
  );

  const initialData =
    initialListingsPage && prefetchedQueryKey === queryKey
      ? { pages: [initialListingsPage], pageParams: [1] as number[] }
      : undefined;

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isPending, isError, error } =
    useInfiniteQuery({
      queryKey: ["marketplace-listings", queryKey],
      queryFn: async ({ pageParam }) => {
        return searchMarketplaceListings({ ...apiInput, page: pageParam as number });
      },
      initialPageParam: 1,
      initialData,
      staleTime: 30_000,
      getNextPageParam: (last) => {
        if (last.page < last.totalPages) return last.page + 1;
        return undefined;
      },
      enabled: !needsRates || ratesReady,
    });

  const rows: MarketplaceListingRow[] = useMemo(
    () => data?.pages.flatMap((p) => p.rows) ?? [],
    [data],
  );

  const deferReady = useDeferListingChainStatusConfirm();
  const chainConfirmEnabled = shouldEnableListingChainStatusConfirm({
    deferReady,
    hasRows: rows.length > 0,
  });
  const { drifts } = useListingChainStatusConfirm(rows, { enabled: chainConfirmEnabled });

  const total = data?.pages[0]?.total ?? 0;
  const ponderError = data?.pages[0]?.ponderError;

  const loadMoreRef = useRef<HTMLDivElement>(null);
  const inView = useInView(loadMoreRef, { margin: "200px" });
  useEffect(() => {
    if (inView && hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [inView, hasNextPage, isFetchingNextPage, fetchNextPage]);

  return (
    <div className="min-h-dvh bg-bg-primary text-text-primary">
      <MarketFilterBar />
      <MarketFilterChips />

      <div className="mx-auto max-w-7xl px-6 py-8 md:px-8 sm:py-10 xl:max-w-[80rem]">
        {total > 0 && (
          <p className="mb-4 font-sans text-sm text-text-secondary">
            {total} {total === 1 ? "listing" : "listings"}
          </p>
        )}

        {ponderError && (
          <EmptyState
            variant="infrastructure"
            level="B"
            role="alert"
            icon={AlertTriangle}
            title="Marketplace unavailable"
            description="Start the indexer to browse listings."
            className="mx-auto mb-4 max-w-sm"
          >
            <code className="inline-block rounded-sm border border-border-default bg-bg-surface px-3 py-1.5 font-mono text-xs text-text-secondary">
              pnpm ponder:dev
            </code>
          </EmptyState>
        )}

        {isPending && needsRates && !ratesReady && (
          <div className="mb-4 rounded-md border border-border-default bg-bg-surface p-4" role="status" aria-live="polite">
            <p className="text-sm text-text-primary">Loading exchange rates…</p>
          </div>
        )}
        {isPending && (!needsRates || ratesReady) && (
          <ul
            className="mb-4 grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-3"
            role="status"
            aria-live="polite"
          >
            {Array.from({ length: 6 }).map((_, i) => (
              <li key={i} aria-hidden>
                <ListingCardSkeleton />
              </li>
            ))}
          </ul>
        )}
        {isError && (
          <div className="mb-4 rounded-md border border-status-error bg-bg-card p-4" role="alert">
            <p className="text-sm font-medium text-status-error">Could not load listings right now.</p>
            <p className="mt-1 text-xs text-status-error">{(error as Error).message}</p>
          </div>
        )}

        {!isPending && !ponderError && rows.length === 0 && (
          <div className="rounded-md border border-border-default bg-bg-surface p-4 text-sm text-text-secondary">
            <EmptyState
              variant="content"
              level="B"
              title="No active listings match these filters yet."
              description="Broaden your filters or clear them to explore more vehicles."
            />
          </div>
        )}

        <FadeUp>
          <ul className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-3">
            {rows.map((row) => (
              <li key={`${row.chainId}-${row.tokenId}`}>
                <ListingCard
                  row={row}
                  chainStatusDrift={drifts.get(listingStatusKey(row.chainId, row.tokenId))}
                />
              </li>
            ))}
          </ul>
        </FadeUp>

        <div ref={loadMoreRef} className="flex justify-center py-8">
          {isFetchingNextPage && <span className="text-sm text-text-secondary">Loading more…</span>}
          {!hasNextPage && rows.length > 0 && (
            <span className="text-xs text-text-secondary">End of results</span>
          )}
        </div>
      </div>
    </div>
  );
}

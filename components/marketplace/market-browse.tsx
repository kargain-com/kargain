"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { useInView } from "framer-motion";
import { AlertTriangle } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef } from "react";

import {
  searchMarketplaceListings,
  type MarketplaceListingRow,
} from "@/app/actions/marketplace-listings";
import { marketFiltersToApiInput } from "@/lib/marketplace/filter-params";
import { ListingCard } from "@/components/marketplace/listing-card";
import {
  MarketFiltersMobile,
  MarketFiltersSidebar,
  MarketSortSelect,
  useMarketFiltersFromUrl,
} from "@/components/marketplace/market-filters";
import { FadeUp } from "@/components/ui/fade-up";
import { useListingChainStatusConfirm } from "@/hooks/use-listing-chain-status-confirm";
import { listingStatusKey } from "@/lib/passport/confirm-listing-status";
import { filtersToSearchParams } from "@/lib/marketplace/filter-params";
import type { MarketSort } from "@/lib/marketplace/filter-params";

export function MarketBrowse({ initialChainId }: { initialChainId: number }) {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const filters = useMarketFiltersFromUrl();

  const rawChain = sp.get("chain");
  const parsed = rawChain ? Number.parseInt(rawChain, 10) : NaN;
  const chainId = Number.isFinite(parsed) ? parsed : initialChainId;

  const apiInput = useMemo(() => marketFiltersToApiInput(filters), [filters]);
  const queryKey = useMemo(() => JSON.stringify(apiInput), [apiInput]);

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isPending, isError, error } =
    useInfiniteQuery({
      queryKey: ["marketplace-listings", queryKey],
      queryFn: async ({ pageParam }) => {
        return searchMarketplaceListings({ ...apiInput, page: pageParam as number });
      },
      initialPageParam: 1,
      getNextPageParam: (last) => {
        if (last.page < last.totalPages) return last.page + 1;
        return undefined;
      },
    });

  const rows: MarketplaceListingRow[] = useMemo(
    () => data?.pages.flatMap((p) => p.rows) ?? [],
    [data],
  );

  const { drifts } = useListingChainStatusConfirm(rows);

  const total = data?.pages[0]?.total ?? 0;
  const ponderError = data?.pages[0]?.ponderError;

  const setSort = useCallback(
    (sort: MarketSort) => {
      const next = { ...filters, sort, page: 1 };
      const qs = filtersToSearchParams(next).toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [filters, pathname, router],
  );

  const loadMoreRef = useRef<HTMLDivElement>(null);
  const inView = useInView(loadMoreRef, { margin: "200px" });
  useEffect(() => {
    if (inView && hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [inView, hasNextPage, isFetchingNextPage, fetchNextPage]);

  return (
    <div className="min-h-dvh bg-bg-primary text-text-primary">
      <div className="mx-auto flex max-w-7xl gap-8 px-4 py-8 sm:py-10">
        <MarketFiltersSidebar />

        <main className="min-w-0 flex-1">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <MarketFiltersMobile />
            <MarketSortSelect sort={filters.sort} onSortChange={setSort} className="w-[200px]" />
          </div>

          {total > 0 && (
            <p className="mb-4 font-sans text-sm text-text-secondary">
              {total} {total === 1 ? "listing" : "listings"}
            </p>
          )}

          {ponderError && (
            <div
              className="mx-auto mb-4 flex max-w-sm flex-col items-center gap-4 py-16 text-center"
              role="alert"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-sm border border-border-default text-text-secondary">
                <AlertTriangle size={20} strokeWidth={1.5} aria-hidden />
              </div>
              <div className="space-y-1">
                <p className="font-sans text-sm font-medium text-text-primary">Marketplace unavailable</p>
                <p className="font-sans text-sm text-text-secondary">Start the indexer to browse listings.</p>
              </div>
              <code className="rounded-sm border border-border-default bg-bg-surface px-3 py-1.5 font-mono text-xs text-text-secondary">
                pnpm ponder:dev
              </code>
            </div>
          )}

          {isPending && (
            <div className="mb-4 rounded-md border border-border-default bg-bg-surface p-4" role="status" aria-live="polite">
              <p className="text-sm text-text-primary">Loading listings…</p>
            </div>
          )}
          {isError && (
            <div className="mb-4 rounded-md border border-status-error bg-bg-card p-4" role="alert">
              <p className="text-sm font-medium text-status-error">Could not load listings right now.</p>
              <p className="mt-1 text-xs text-status-error">{(error as Error).message}</p>
            </div>
          )}

          {!isPending && !ponderError && rows.length === 0 && (
            <div className="rounded-md border border-border-default bg-bg-surface p-5 text-sm text-text-secondary">
              <p className="font-medium text-text-primary">No active listings match these filters yet.</p>
              <p className="mt-1 text-xs text-text-secondary">
                Broaden your filters or clear them to explore more vehicles.
              </p>
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
        </main>
      </div>

      <footer className="border-t border-border-default py-16 text-center text-xs text-text-secondary">
        Multi-chain KarPassport · USDC / native escrow · Chainlink quotes · Ponder indexer
      </footer>
    </div>
  );
}

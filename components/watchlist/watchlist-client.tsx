"use client";

import { useQuery } from "@tanstack/react-query";
import { Bookmark } from "lucide-react";
import { useAccount } from "wagmi";

import { loadFavoriteListingCards } from "@/app/actions/favorite-listings";
import { ListingCard } from "@/components/marketplace/listing-card";
import { WalletLoginButton } from "@/components/wallet-login-button";
import { useWatchlist } from "@/hooks/use-watchlist";

const GRID_CLASS = {
  wide: "grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-3",
  narrow: "grid grid-cols-1 gap-3 sm:grid-cols-2",
} as const;

type WatchlistLayout = keyof typeof GRID_CLASS;

function ListingCardSkeleton() {
  return (
    <div className="h-full overflow-hidden rounded-md border border-border-default bg-bg-card">
      <div className="aspect-[16/10] w-full animate-pulse bg-bg-surface" />
      <div className="space-y-2.5 p-6">
        <div className="h-4 w-3/4 animate-pulse rounded bg-bg-surface" />
        <div className="h-3 w-1/2 animate-pulse rounded bg-bg-surface" />
        <div className="h-6 w-1/3 animate-pulse rounded bg-bg-surface" />
      </div>
    </div>
  );
}

type Props = {
  /** `narrow` for profile (`max-w-2xl`); `wide` for notifications / full-width pages. */
  layout?: WatchlistLayout;
};

export function WatchlistClient({ layout = "wide" }: Props) {
  const gridClass = GRID_CLASS[layout];
  const { isConnected } = useAccount();
  const { watchedIds, isLoading } = useWatchlist();

  const { data: listingData, isPending: listingsPending } = useQuery({
    queryKey: ["watchlist-listings", watchedIds],
    queryFn: () => loadFavoriteListingCards(watchedIds),
    enabled: isConnected && watchedIds.length > 0 && !isLoading,
  });

  const listingsLoading = isLoading || (watchedIds.length > 0 && listingsPending);
  const listings = listingData?.listings ?? [];

  return (
    <>
      {!isConnected && (
        <div className="mt-8 space-y-3 rounded-md border border-border-default bg-bg-surface p-4">
          <p className="font-sans text-sm text-text-secondary">
            Connect your wallet to save vehicles to your watchlist.
          </p>
          <WalletLoginButton />
        </div>
      )}

      {isConnected && listingsLoading && (
        <ul className={gridClass}>
          {Array.from({ length: Math.max(watchedIds.length, 3) }).map((_, i) => (
            <li key={i}>
              <ListingCardSkeleton />
            </li>
          ))}
        </ul>
      )}

      {isConnected && !listingsLoading && watchedIds.length === 0 && (
        <div className="py-8 text-center">
          <Bookmark
            size={48}
            strokeWidth={1}
            className="mx-auto text-text-tertiary"
            aria-hidden
          />
          <h2 className="mt-4 font-display text-fluid-h2 font-medium text-text-primary">
            Your watchlist is empty
          </h2>
          <p className="mx-auto mt-2 max-w-sm font-sans text-sm text-text-secondary">
            Save vehicles from any listing to track them here.
          </p>
        </div>
      )}

      {isConnected && !listingsLoading && watchedIds.length > 0 && (
        <div className="space-y-6">
          {listingData?.ponderError && (
            <p className="rounded-md border border-border-default bg-bg-surface p-4 font-sans text-sm text-text-secondary">
              Indexer unavailable. Start the Ponder indexer to load saved listings.
            </p>
          )}
          <ul className={gridClass}>
            {listings.map((row) => (
              <li key={row.tokenId}>
                <ListingCard row={row} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

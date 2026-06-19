"use client";

import { useQuery } from "@tanstack/react-query";
import { Bookmark } from "lucide-react";
import { useAccount } from "wagmi";

import { loadFavoriteListingCards } from "@/app/actions/favorite-listings";
import { ListingCard } from "@/components/marketplace/listing-card";
import { WalletLoginButton } from "@/components/wallet-login-button";
import { useWatchlist } from "@/hooks/use-watchlist";

function ListingCardSkeleton() {
  return (
    <div className="h-full overflow-hidden rounded-md border border-border-default bg-bg-card">
      <div className="aspect-[16/10] w-full animate-pulse bg-bg-surface" />
      <div className="space-y-2.5 p-4">
        <div className="h-4 w-3/4 animate-pulse rounded bg-bg-surface" />
        <div className="h-3 w-1/2 animate-pulse rounded bg-bg-surface" />
        <div className="h-6 w-1/3 animate-pulse rounded bg-bg-surface" />
      </div>
    </div>
  );
}

export function WatchlistClient({ embedded = false }: { embedded?: boolean }) {
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
    <div className={embedded ? undefined : "mx-auto max-w-7xl xl:max-w-[80rem]"}>
      {!embedded && (
        <h1 className="font-display text-fluid-h2 font-medium text-text-primary">Watchlist</h1>
      )}

      {!isConnected && (
        <div className="mt-8 space-y-3 rounded-md border border-border-default bg-bg-surface p-4">
          <p className="font-sans text-sm text-text-secondary">
            Connect your wallet to save vehicles to your watchlist.
          </p>
          <WalletLoginButton />
        </div>
      )}

      {isConnected && listingsLoading && (
        <ul className={embedded ? "mt-0 grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-3" : "mt-8 grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-3"}>
          {Array.from({ length: Math.max(watchedIds.length, 3) }).map((_, i) => (
            <li key={i}>
              <ListingCardSkeleton />
            </li>
          ))}
        </ul>
      )}

      {isConnected && !listingsLoading && watchedIds.length === 0 && (
        <div className={embedded ? "py-8 text-center" : "mt-8 py-8 text-center"}>
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
        <div className={embedded ? "space-y-6" : "mt-8 space-y-6"}>
          {listingData?.ponderError && (
            <p className="rounded-sm border border-border-default bg-bg-surface p-3 font-sans text-sm text-text-secondary">
              Indexer unavailable. Start the Ponder indexer to load saved listings.
            </p>
          )}
          <ul className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-3">
            {listings.map((row) => (
              <li key={row.tokenId}>
                <ListingCard row={row} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

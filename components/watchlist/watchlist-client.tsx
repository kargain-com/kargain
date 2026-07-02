"use client";

import { useQuery } from "@tanstack/react-query";
import { Bookmark } from "lucide-react";
import { useAccount } from "wagmi";

import { loadFavoriteListingCards } from "@/app/actions/favorite-listings";
import { ListingCard } from "@/components/marketplace/listing-card";
import { ListingCardSkeleton } from "@/components/marketplace/listing-card-skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { WalletLoginButton } from "@/components/wallet-login-button";
import { useWatchlist } from "@/hooks/use-watchlist";

const GRID_CLASS = {
  wide: "grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-3",
  narrow: "grid grid-cols-1 gap-3 sm:grid-cols-2",
} as const;

type WatchlistLayout = keyof typeof GRID_CLASS;

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
        <div className="mt-8 space-y-3">
          <EmptyState
            variant="infrastructure"
            level="B"
            title="Connect your wallet to save vehicles to your watchlist."
          />
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
        <EmptyState
          variant="content"
          level="A"
          icon={Bookmark}
          title="Your watchlist is empty"
          description="Save vehicles from any listing to track them here."
        />
      )}

      {isConnected && !listingsLoading && watchedIds.length > 0 && (
        <div className="space-y-6">
          {listingData?.ponderError && (
            <EmptyState
              variant="infrastructure"
              level="B"
              role="alert"
              title="Indexer unavailable"
              description="Start the Ponder indexer to load saved listings."
            />
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

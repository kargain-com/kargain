"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useAccount } from "wagmi";

import { loadFavoriteListingCards } from "@/app/actions/favorite-listings";
import { ListingCard } from "@/components/marketplace/listing-card";
import { useNostrKey } from "@/hooks/use-nostr-key";
import { loadFavorites } from "@/lib/nostr/favorites";
import {
  nostrPubkeyFromPrivateKey,
  resolveNostrPubkeyForEthereumAddress,
} from "@/lib/nostr/nostr-client";

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

export function ProfileFavoritesSection({ wallet }: { wallet: `0x${string}` }) {
  const { address, isConnected } = useAccount();
  const { nostrPrivateKey, loading: keyLoading } = useNostrKey();
  const [resolvingPubkey, setResolvingPubkey] = useState(true);
  const [tokenIds, setTokenIds] = useState<string[]>([]);
  const [loadingFavorites, setLoadingFavorites] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function resolve() {
      setResolvingPubkey(true);
      setLoadingFavorites(true);

      let resolved: string | null = null;
      if (isConnected && address?.toLowerCase() === wallet.toLowerCase() && nostrPrivateKey) {
        resolved = nostrPubkeyFromPrivateKey(nostrPrivateKey);
      } else {
        resolved = await resolveNostrPubkeyForEthereumAddress(wallet);
      }

      if (cancelled) return;
      setResolvingPubkey(false);

      if (!resolved) {
        setTokenIds([]);
        setLoadingFavorites(false);
        return;
      }

      const ids = await loadFavorites(resolved);
      if (!cancelled) {
        setTokenIds(ids);
        setLoadingFavorites(false);
      }
    }

    if (isConnected && address?.toLowerCase() === wallet.toLowerCase() && keyLoading) {
      return;
    }

    void resolve();
    return () => {
      cancelled = true;
    };
  }, [address, isConnected, keyLoading, nostrPrivateKey, wallet]);

  const { data: listingData, isPending: listingsPending } = useQuery({
    queryKey: ["profile-favorite-listings", tokenIds],
    queryFn: () => loadFavoriteListingCards(tokenIds),
    enabled: tokenIds.length > 0 && !loadingFavorites,
  });

  const isLoading = resolvingPubkey || loadingFavorites || (tokenIds.length > 0 && listingsPending);

  if (!isLoading && tokenIds.length === 0) {
    return null;
  }

  const listings = listingData?.listings ?? [];

  return (
    <section>
      <h2 className="mb-3 text-sm font-medium uppercase tracking-wider text-text-secondary">Saved</h2>
      {listingData?.ponderError && (
        <p className="mb-3 rounded-sm border border-border-default bg-bg-surface p-3 text-sm text-text-secondary">
          Indexer unavailable. Start the Ponder indexer to load saved listings.
        </p>
      )}
      {isLoading ? (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: Math.max(tokenIds.length, 2) }).map((_, i) => (
            <li key={i}>
              <ListingCardSkeleton />
            </li>
          ))}
        </ul>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {listings.map((row) => (
            <li key={row.tokenId}>
              <ListingCard row={row} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

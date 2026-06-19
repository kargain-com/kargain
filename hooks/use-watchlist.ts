"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAccount } from "wagmi";

import { useNostrKey } from "@/hooks/use-nostr-key";
import { addFavorite, loadFavorites, removeFavorite } from "@/lib/nostr/favorites";
import { nostrPubkeyFromPrivateKey, publishEthereumIdentityLink } from "@/lib/nostr/nostr-client";

export function useWatchlist(tokenId?: string) {
  const { isConnected, address } = useAccount();
  const { nostrPrivateKey, loading: keyLoading } = useNostrKey();
  const [watchedIds, setWatchedIds] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isToggling, setIsToggling] = useState(false);

  const pubkey = useMemo(
    () => (nostrPrivateKey ? nostrPubkeyFromPrivateKey(nostrPrivateKey) : null),
    [nostrPrivateKey],
  );

  const isWatched = tokenId ? watchedIds.includes(tokenId) : false;

  useEffect(() => {
    if (!isConnected || !pubkey || keyLoading) {
      setWatchedIds([]);
      setIsLoading(keyLoading && isConnected);
      return;
    }

    let cancelled = false;
    setIsLoading(true);

    void (async () => {
      try {
        const ids = await loadFavorites(pubkey);
        if (!cancelled) setWatchedIds(ids);
      } catch (err) {
        console.error("useWatchlist load failed", err);
        if (!cancelled) setWatchedIds([]);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isConnected, pubkey, keyLoading]);

  const toggle = useCallback(async () => {
    if (!tokenId || !nostrPrivateKey) return;

    const wasWatched = watchedIds.includes(tokenId);
    setIsToggling(true);

    if (wasWatched) {
      setWatchedIds((prev) => prev.filter((id) => id !== tokenId));
    } else {
      setWatchedIds((prev) => [...prev, tokenId]);
    }

    try {
      if (wasWatched) {
        await removeFavorite(tokenId, nostrPrivateKey);
      } else {
        await addFavorite(tokenId, nostrPrivateKey);
        if (address) {
          void publishEthereumIdentityLink(nostrPrivateKey, address);
        }
      }
    } catch (err) {
      console.error("useWatchlist toggle failed", err);
      setWatchedIds((prev) =>
        wasWatched ? [...prev, tokenId] : prev.filter((id) => id !== tokenId),
      );
    } finally {
      setIsToggling(false);
    }
  }, [tokenId, nostrPrivateKey, watchedIds, address]);

  return { watchedIds, isWatched, isLoading, isToggling, toggle };
}

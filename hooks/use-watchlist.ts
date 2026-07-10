"use client";

import { useCallback, useEffect, useState } from "react";
import { useAccount } from "wagmi";

import { useNostrKey } from "@/hooks/use-nostr-key";
import { addFavorite, loadFavorites, removeFavorite } from "@/lib/nostr/favorites";

export function useWatchlist(tokenId?: string) {
  const { isConnected } = useAccount();
  const { nostrPrivateKey, nostrPubkey, loading: keyLoading, ensureNostrKey } = useNostrKey();
  const [watchedIds, setWatchedIds] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isToggling, setIsToggling] = useState(false);

  const pubkey = nostrPubkey;

  const isWatched = tokenId ? watchedIds.includes(tokenId) : false;

  useEffect(() => {
    if (!isConnected || !pubkey) {
      setWatchedIds([]);
      setIsLoading(keyLoading && isConnected && !pubkey);
      return;
    }

    let cancelled = false;
    setIsLoading(true);

    void (async () => {
      try {
        const ids = await loadFavorites(pubkey);
        if (!cancelled) setWatchedIds(ids);
      } catch {
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
    if (!tokenId) return;

    const key = nostrPrivateKey ?? (await ensureNostrKey());
    if (!key) return;

    const wasWatched = watchedIds.includes(tokenId);
    setIsToggling(true);

    if (wasWatched) {
      setWatchedIds((prev) => prev.filter((id) => id !== tokenId));
    } else {
      setWatchedIds((prev) => [...prev, tokenId]);
    }

    try {
      const ok = wasWatched
        ? await removeFavorite(tokenId, key)
        : await addFavorite(tokenId, key);
      if (!ok) {
        setWatchedIds((prev) =>
          wasWatched ? [...prev, tokenId] : prev.filter((id) => id !== tokenId),
        );
      }
    } catch {
      setWatchedIds((prev) =>
        wasWatched ? [...prev, tokenId] : prev.filter((id) => id !== tokenId),
      );
    } finally {
      setIsToggling(false);
    }
  }, [tokenId, nostrPrivateKey, ensureNostrKey, watchedIds]);

  return { watchedIds, isWatched, isLoading, isToggling, toggle };
}

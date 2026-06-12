"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAccount } from "wagmi";

import { useNostrKey } from "@/hooks/use-nostr-key";
import {
  addFavorite as addFavoriteLib,
  loadFavorites,
  removeFavorite as removeFavoriteLib,
} from "@/lib/nostr/favorites";
import {
  nostrPubkeyFromPrivateKey,
  publishEthereumIdentityLink,
} from "@/lib/nostr/nostr-client";

export function useFavorites() {
  const { isConnected, address } = useAccount();
  const { nostrPrivateKey, loading: keyLoading } = useNostrKey();
  const [favorites, setFavorites] = useState<string[]>([]);
  const [loadedPubkey, setLoadedPubkey] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const pubkey = useMemo(
    () => (nostrPrivateKey ? nostrPubkeyFromPrivateKey(nostrPrivateKey) : null),
    [nostrPrivateKey],
  );

  const refresh = useCallback(async () => {
    if (!isConnected || !pubkey) {
      setFavorites([]);
      return;
    }
    const ids = await loadFavorites(pubkey);
    setFavorites(ids);
  }, [isConnected, pubkey]);

  const active = isConnected && Boolean(pubkey) && !keyLoading;
  const activePubkey = active && pubkey ? pubkey : null;
  const isLoading = Boolean(activePubkey && loadedPubkey !== activePubkey);

  useEffect(() => {
    if (!activePubkey) return;
    let cancelled = false;
    void loadFavorites(activePubkey).then((ids) => {
      if (!cancelled) {
        setFavorites(ids);
        setLoadedPubkey(activePubkey);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [activePubkey]);

  const visibleFavorites = useMemo(() => (active ? favorites : []), [active, favorites]);

  const addFavorite = useCallback(
    async (tokenId: string) => {
      if (!isConnected || !nostrPrivateKey) return;
      setFavorites((prev) => (prev.includes(tokenId) ? prev : [...prev, tokenId]));
      setIsSaving(true);
      await addFavoriteLib(tokenId, nostrPrivateKey);
      await refresh();
      if (address) {
        void publishEthereumIdentityLink(nostrPrivateKey, address);
      }
      setIsSaving(false);
    },
    [address, isConnected, nostrPrivateKey, refresh],
  );

  const removeFavorite = useCallback(
    async (tokenId: string) => {
      if (!isConnected || !nostrPrivateKey) return;
      setFavorites((prev) => prev.filter((id) => id !== tokenId));
      setIsSaving(true);
      await removeFavoriteLib(tokenId, nostrPrivateKey);
      await refresh();
      setIsSaving(false);
    },
    [isConnected, nostrPrivateKey, refresh],
  );

  const isFavorite = useCallback(
    (tokenId: string) => visibleFavorites.includes(tokenId),
    [visibleFavorites],
  );

  return {
    favorites: visibleFavorites,
    isLoading: keyLoading || isLoading,
    isSaving,
    addFavorite,
    removeFavorite,
    isFavorite,
  };
}

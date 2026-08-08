"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAccount } from "wagmi";

import { fetchListingBatch, fetchPassportBatch } from "@/app/actions/notifications";
import { useNotificationState } from "@/hooks/use-notification-state";
import { useWatchlist } from "@/hooks/use-watchlist";
import { mapWatchlistDiffs } from "@/lib/notifications/map-watchlist-diff";
import type { NotificationItem, WatchlistSnapshot } from "@/lib/notifications/types";
import type { WatchlistSnapshotDiff } from "@/lib/notifications/watchlist-snapshot";
import {
  diffSnapshots,
  loadSnapshots,
  saveSnapshots,
} from "@/lib/notifications/watchlist-snapshot";

function buildSnapshots(
  tokenIds: string[],
  passports: Array<{ id: string; status: string; updatedAt: string | number }>,
  listings: Array<{
    tokenId: string;
    active: boolean;
    fiatPrice1e8: string | number;
    price?: string | number;
    denominationKind?: number;
  }>,
): WatchlistSnapshot[] {
  const passportById = new Map(passports.map((p) => [p.id, p]));
  const listingByToken = new Map(listings.map((l) => [l.tokenId, l]));
  const capturedAt = Math.floor(Date.now() / 1000);

  return tokenIds.map((tokenId) => {
    const passport = passportById.get(tokenId);
    const listing = listingByToken.get(tokenId);
    const fiatPrice1e8 =
      listing?.fiatPrice1e8 != null ? String(listing.fiatPrice1e8) : "0";
    const denominationKind =
      listing?.denominationKind === 0 || listing?.denominationKind === 1
        ? listing.denominationKind
        : 1;
    const price =
      listing?.price != null ? String(listing.price) : fiatPrice1e8;
    return {
      tokenId,
      status: passport?.status ?? "UNVERIFIED",
      active: listing?.active ?? false,
      price,
      denominationKind,
      fiatPrice1e8,
      updatedAt: passport?.updatedAt != null ? String(passport.updatedAt) : "0",
      capturedAt,
    };
  });
}

export function useWatchlistNotifications(): {
  items: NotificationItem[];
  isLoading: boolean;
} {
  const { isConnected } = useAccount();
  const { watchedIds, isLoading: watchlistLoading } = useWatchlist();
  const { state } = useNotificationState();

  const { data: diffs, isPending } = useQuery({
    queryKey: ["watchlist-batch", watchedIds],
    queryFn: async (): Promise<WatchlistSnapshotDiff[]> => {
      const [passportResult, listingResult] = await Promise.all([
        fetchPassportBatch(watchedIds),
        fetchListingBatch(watchedIds),
      ]);
      const current = buildSnapshots(
        watchedIds,
        passportResult.passports,
        listingResult.listings,
      );
      const previous = await loadSnapshots();
      const snapshotDiffs = diffSnapshots(previous, current);
      await saveSnapshots(current);
      return snapshotDiffs;
    },
    enabled: isConnected && watchedIds.length > 0 && !watchlistLoading,
    staleTime: 45_000,
    refetchInterval: 60_000,
  });

  const items = useMemo(
    () => mapWatchlistDiffs(diffs ?? [], state.lastSeenAt.watchlist),
    [diffs, state.lastSeenAt.watchlist],
  );

  return {
    items,
    isLoading: watchlistLoading || (watchedIds.length > 0 && isPending),
  };
}

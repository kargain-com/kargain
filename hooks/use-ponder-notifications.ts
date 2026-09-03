"use client";

import { useActiveAccount, requireEvmSession } from "@/hooks/use-active-account";

import { useQuery } from "@tanstack/react-query";

import { fetchNotificationFeed } from "@/app/actions/notifications";
import { useNotificationState } from "@/hooks/use-notification-state";
import { mapPonderFeedItems } from "@/lib/notifications/map-ponder-feed";
import type { NotificationItem } from "@/lib/notifications/types";

export function usePonderNotifications(): {
  items: NotificationItem[];
  isLoading: boolean;
  error: string | null;
} {
  const { account } = useActiveAccount();
  const evm = requireEvmSession(account);
  const address = evm.ok ? evm.address : undefined;
  const isConnected = evm.ok;
  const { state } = useNotificationState();

  const { data, isPending, error } = useQuery({
    queryKey: ["ponder-notifications", address, state.lastSeenAt.ponder],
    queryFn: async () => fetchNotificationFeed(address!, state.lastSeenAt.ponder),
    enabled: isConnected && Boolean(address),
    staleTime: 20_000,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });

  const items = mapPonderFeedItems(data?.items ?? [], state.lastSeenAt.ponder, address);

  return {
    items,
    isLoading: isPending,
    error: data?.ponderError ?? (error ? "PONDER_UNAVAILABLE" : null),
  };
}

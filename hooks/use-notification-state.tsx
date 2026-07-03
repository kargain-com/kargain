"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Address } from "viem";
import { useAccount } from "wagmi";

import {
  loadNotificationState,
  mergeNotificationStates,
  saveNotificationState,
  type NotificationLastSeenAt,
  type NotificationState,
} from "@/lib/nostr/notification-state";
import { useNostrKey } from "@/hooks/use-nostr-key";
import {
  loadLocalNotificationState,
  saveLocalNotificationState,
} from "@/lib/notifications/local-notification-state";
import { useOwnedPassportTokenIds } from "@/hooks/use-owned-passport-token-ids";
import { usePonderNotifications } from "@/hooks/use-ponder-notifications";
import { useWatchlistNotifications } from "@/hooks/use-watchlist-notifications";
import { useNostrNotificationsSub } from "@/hooks/use-nostr-notifications-sub";
import type { NotificationItem } from "@/lib/notifications/types";

const DEFAULT_STATE: NotificationState = {
  lastSeenAt: { ponder: 0, nostr: 0, watchlist: 0 },
};

type NotificationStateContextValue = {
  state: NotificationState;
  isLoading: boolean;
  markRead: (
    channels: Array<keyof NotificationLastSeenAt>,
    upToTimestamp: number,
  ) => void | Promise<void>;
};

const NotificationStateContext = createContext<NotificationStateContextValue | null>(null);

type NotificationsFeedContextValue = {
  items: NotificationItem[];
  unreadCount: number;
  isLoading: boolean;
  markRead: (
    channels: Array<keyof NotificationLastSeenAt>,
    upToTimestamp: number,
  ) => void | Promise<void>;
  state: NotificationState;
};

const NotificationsFeedContext = createContext<NotificationsFeedContextValue | null>(null);

export function useNotificationState(): NotificationStateContextValue {
  const ctx = useContext(NotificationStateContext);
  if (!ctx) {
    throw new Error("useNotificationState must be used within NotificationsProvider");
  }
  return ctx;
}

function NotificationStateProvider({ children }: { children: ReactNode }) {
  const { isConnected, address } = useAccount();
  const { nostrPrivateKey, nostrPubkey, ensureNostrKey } = useNostrKey();
  const [state, setState] = useState<NotificationState>(DEFAULT_STATE);
  const [isLoading, setIsLoading] = useState(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    if (!isConnected || !address) {
      setState(DEFAULT_STATE);
      setIsLoading(false);
      return;
    }

    const local = loadLocalNotificationState(address as Address);
    setState(local);

    if (!nostrPubkey) {
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    setIsLoading(true);

    void (async () => {
      try {
        const remote = await loadNotificationState(address as Address, nostrPubkey);
        const merged = mergeNotificationStates(local, remote);
        if (!cancelled) setState(merged);
      } catch (err) {
        console.error("useNotificationState load failed", err);
        if (!cancelled) setState(local);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isConnected, address, nostrPubkey]);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  const markRead = useCallback(
    async (channels: Array<keyof NotificationLastSeenAt>, upToTimestamp: number) => {
      if (!address) return;

      setState((prev) => {
        const nextLastSeen = { ...prev.lastSeenAt };
        for (const channel of channels) {
          nextLastSeen[channel] = Math.max(nextLastSeen[channel], upToTimestamp);
        }
        const next = { lastSeenAt: nextLastSeen };
        stateRef.current = next;
        saveLocalNotificationState(address as Address, next);
        return next;
      });

      const key = nostrPrivateKey ?? (await ensureNostrKey());
      if (!key) return;

      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        void saveNotificationState(
          address as Address,
          stateRef.current,
          key,
        );
      }, 400);
    },
    [address, nostrPrivateKey, ensureNostrKey],
  );

  const value = useMemo(
    () => ({ state, isLoading, markRead }),
    [state, isLoading, markRead],
  );

  return (
    <NotificationStateContext.Provider value={value}>
      {children}
    </NotificationStateContext.Provider>
  );
}

function NotificationsFeedComposer({ children }: { children: ReactNode }) {
  const { state, isLoading: stateLoading, markRead } = useNotificationState();
  const { nostrPubkey } = useNostrKey();
  const ponder = usePonderNotifications();
  const watchlist = useWatchlistNotifications();
  const ownedTokenIds = useOwnedPassportTokenIds();
  const nostr = useNostrNotificationsSub(ownedTokenIds);

  const items = useMemo(() => {
    const byId = new Map<string, NotificationItem>();
    for (const item of [...ponder.items, ...watchlist.items, ...nostr.items]) {
      byId.set(item.id, item);
    }
    return [...byId.values()].sort((a, b) => b.timestamp - a.timestamp);
  }, [ponder.items, watchlist.items, nostr.items]);

  const unreadCount = useMemo(() => items.filter((item) => !item.read).length, [items]);

  const isLoading =
    ponder.isLoading ||
    watchlist.isLoading ||
    nostr.isLoading ||
    (Boolean(nostrPubkey) && stateLoading);

  const value = useMemo(
    () => ({
      items,
      unreadCount,
      isLoading,
      markRead,
      state,
    }),
    [items, unreadCount, isLoading, markRead, state],
  );

  return (
    <NotificationsFeedContext.Provider value={value}>{children}</NotificationsFeedContext.Provider>
  );
}

export function NotificationsProvider({ children }: { children: ReactNode }) {
  return (
    <NotificationStateProvider>
      <NotificationsFeedComposer>{children}</NotificationsFeedComposer>
    </NotificationStateProvider>
  );
}

export function useNotificationsFeedContext(): NotificationsFeedContextValue {
  const ctx = useContext(NotificationsFeedContext);
  if (!ctx) {
    throw new Error("useNotificationsFeed must be used within NotificationsProvider");
  }
  return ctx;
}

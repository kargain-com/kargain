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
  saveNotificationState,
  type NotificationLastSeenAt,
  type NotificationState,
} from "@/lib/nostr/notification-state";
import { nostrPubkeyFromPrivateKey } from "@/lib/nostr/nostr-client";
import { useNostrKey } from "@/hooks/use-nostr-key";
import { usePonderNotifications } from "@/hooks/use-ponder-notifications";
import { useWatchlistNotifications } from "@/hooks/use-watchlist-notifications";
import { useNostrNotificationsSub } from "@/hooks/use-nostr-notifications-sub";
import type { NotificationItem } from "@/lib/notifications/types";

const DEFAULT_STATE: NotificationState = {
  lastSeenAt: { ponder: 0, nostr: 0, watchlist: 0 },
};

/** Phase 1: no owned-passport #d filters yet — stable ref for effect deps */
const OWNED_TOKEN_IDS_V1: string[] = [];

type NotificationStateContextValue = {
  state: NotificationState;
  isLoading: boolean;
  markRead: (channels: Array<keyof NotificationLastSeenAt>, upToTimestamp: number) => void;
};

const NotificationStateContext = createContext<NotificationStateContextValue | null>(null);

type NotificationsFeedContextValue = {
  items: NotificationItem[];
  unreadCount: number;
  isLoading: boolean;
  markRead: (channels: Array<keyof NotificationLastSeenAt>, upToTimestamp: number) => void;
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
  const { nostrPrivateKey } = useNostrKey();
  const [state, setState] = useState<NotificationState>(DEFAULT_STATE);
  const [isLoading, setIsLoading] = useState(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  const pubkey = useMemo(
    () => (nostrPrivateKey ? nostrPubkeyFromPrivateKey(nostrPrivateKey) : null),
    [nostrPrivateKey],
  );

  useEffect(() => {
    if (!isConnected || !address || !nostrPrivateKey || !pubkey) {
      setState(DEFAULT_STATE);
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    setIsLoading(true);

    void (async () => {
      try {
        const loaded = await loadNotificationState(
          address as Address,
          pubkey,
          nostrPrivateKey,
        );
        if (!cancelled) setState(loaded);
      } catch (err) {
        console.error("useNotificationState load failed", err);
        if (!cancelled) setState(DEFAULT_STATE);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isConnected, address, nostrPrivateKey, pubkey]);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  const markRead = useCallback(
    (channels: Array<keyof NotificationLastSeenAt>, upToTimestamp: number) => {
      if (!address || !nostrPrivateKey) return;

      setState((prev) => {
        const nextLastSeen = { ...prev.lastSeenAt };
        for (const channel of channels) {
          nextLastSeen[channel] = Math.max(nextLastSeen[channel], upToTimestamp);
        }
        const next = { lastSeenAt: nextLastSeen };
        stateRef.current = next;
        return next;
      });

      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        void saveNotificationState(
          address as Address,
          stateRef.current,
          nostrPrivateKey,
        );
      }, 400);
    },
    [address, nostrPrivateKey],
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
  const ponder = usePonderNotifications();
  const watchlist = useWatchlistNotifications();
  const nostr = useNostrNotificationsSub(OWNED_TOKEN_IDS_V1);

  const items = useMemo(() => {
    const byId = new Map<string, NotificationItem>();
    for (const item of [...ponder.items, ...watchlist.items, ...nostr.items]) {
      byId.set(item.id, item);
    }
    return [...byId.values()].sort((a, b) => b.timestamp - a.timestamp);
  }, [ponder.items, watchlist.items, nostr.items]);

  const unreadCount = useMemo(() => items.filter((item) => !item.read).length, [items]);

  const isLoading = stateLoading || ponder.isLoading || watchlist.isLoading;

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

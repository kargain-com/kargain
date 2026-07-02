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

import { useXmtpClient } from "@/hooks/use-xmtp-client";
import {
  CONVERSATIONS_SYNC_DEBOUNCE_MS,
  CONVERSATIONS_SYNC_INTERVAL_MS,
  shouldSyncConversations,
} from "@/lib/xmtp/conversations-sync-schedule";
import {
  loadConversationSummaries,
  sumUnreadCounts,
  type ConversationSummary,
} from "@/lib/xmtp/load-conversation-summaries";

const CATCH_UP_DISMISSED_KEY = "xmtp:catchUpDismissed";

type SyncTrigger = "client" | "visibility" | "focus" | "interval" | "manual" | "event";

type XmtpConversationsContextValue = {
  conversations: ConversationSummary[];
  isLoading: boolean;
  unreadTotal: number;
  catchUpNewCount: number;
  lastSyncAt: number | null;
  refresh: () => void;
  dismissCatchUp: () => void;
};

const XmtpConversationsContext = createContext<XmtpConversationsContextValue | null>(null);

export function useXmtpConversationsContext(): XmtpConversationsContextValue {
  const ctx = useContext(XmtpConversationsContext);
  if (!ctx) {
    throw new Error("useXmtpConversationsContext must be used within XmtpConversationsProvider");
  }
  return ctx;
}

export function XmtpConversationsProvider({ children }: { children: ReactNode }) {
  const { client } = useXmtpClient();
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null);
  const [catchUpNewCount, setCatchUpNewCount] = useState(0);
  const [refreshToken, setRefreshToken] = useState(0);

  const lastSyncAtRef = useRef<number | null>(null);
  const unreadTotalRef = useRef(0);
  const syncInFlightRef = useRef(false);
  const clientRef = useRef(client);
  clientRef.current = client;

  const unreadTotal = useMemo(() => sumUnreadCounts(conversations), [conversations]);
  unreadTotalRef.current = unreadTotal;

  const dismissCatchUp = useCallback(() => {
    setCatchUpNewCount(0);
    if (typeof window !== "undefined") {
      sessionStorage.setItem(CATCH_UP_DISMISSED_KEY, "1");
    }
  }, []);

  const refresh = useCallback(() => {
    setRefreshToken((value) => value + 1);
  }, []);

  const runSync = useCallback(async (trigger: SyncTrigger, force = false) => {
    const activeClient = clientRef.current;
    if (!activeClient) return;

    const now = Date.now();
    if (!force && !shouldSyncConversations(lastSyncAtRef.current, now, CONVERSATIONS_SYNC_DEBOUNCE_MS)) {
      return;
    }
    if (syncInFlightRef.current) return;

    syncInFlightRef.current = true;
    const preUnread = unreadTotalRef.current;
    const trackCatchUp = trigger === "visibility" || trigger === "focus";

    setIsLoading(true);
    try {
      const summaries = await loadConversationSummaries(activeClient);
      const newUnread = sumUnreadCounts(summaries);
      setConversations(summaries);
      const syncedAt = Date.now();
      lastSyncAtRef.current = syncedAt;
      setLastSyncAt(syncedAt);

      if (trackCatchUp && newUnread > preUnread) {
        const delta = newUnread - preUnread;
        setCatchUpNewCount(delta);
        if (typeof window !== "undefined") {
          sessionStorage.removeItem(CATCH_UP_DISMISSED_KEY);
        }
      }
    } catch {
      setConversations([]);
    } finally {
      syncInFlightRef.current = false;
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!client) {
      setConversations([]);
      setIsLoading(false);
      setLastSyncAt(null);
      setCatchUpNewCount(0);
      lastSyncAtRef.current = null;
      return;
    }

    void runSync("client", true);
  }, [client, refreshToken, runSync]);

  useEffect(() => {
    if (!client) return;

    const onVisibility = () => {
      if (document.visibilityState !== "visible") return;
      void runSync("visibility");
    };

    const onFocus = () => {
      void runSync("focus");
    };

    const onConversationsChanged = () => {
      void runSync("event");
    };

    const onLastSeenUpdated = () => {
      void runSync("event", true);
    };

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onFocus);
    window.addEventListener("xmtp:conversations-changed", onConversationsChanged);
    window.addEventListener("xmtp:lastseen-updated", onLastSeenUpdated);

    const intervalId = window.setInterval(() => {
      void runSync("interval");
    }, CONVERSATIONS_SYNC_INTERVAL_MS);

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("xmtp:conversations-changed", onConversationsChanged);
      window.removeEventListener("xmtp:lastseen-updated", onLastSeenUpdated);
      window.clearInterval(intervalId);
    };
  }, [client, runSync]);

  const value = useMemo(
    () => ({
      conversations,
      isLoading,
      unreadTotal,
      catchUpNewCount,
      lastSyncAt,
      refresh,
      dismissCatchUp,
    }),
    [
      conversations,
      isLoading,
      unreadTotal,
      catchUpNewCount,
      lastSyncAt,
      refresh,
      dismissCatchUp,
    ],
  );

  return (
    <XmtpConversationsContext.Provider value={value}>
      {children}
    </XmtpConversationsContext.Provider>
  );
}

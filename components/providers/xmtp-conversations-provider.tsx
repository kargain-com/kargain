"use client";

import { useActiveAccount, requireEvmSession } from "@/hooks/use-active-account";

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
import { getAddress } from "viem";

import { useMessagingSession } from "@/hooks/use-messaging-session";
import {
  readPendingReceipts,
  writePendingReceipts,
} from "@/lib/messaging/adapters/cache-adapter";
import {
  markConversationRead,
  openInboxDeliveryStreams,
  type InboxDeliveryHandle,
  type XmtpSdkClient,
} from "@/lib/messaging/adapters/xmtp-adapter";
import {
  loadConsentPartitionedSummaries,
  sumUnreadCounts,
  type ConversationSummary,
} from "@/lib/messaging/conversations";
import { getMessagingXmtpEnv } from "@/lib/messaging/xmtp-env";

const CATCH_UP_DISMISSED_KEY = "xmtp:catchUpDismissed";

type SyncTrigger = "client" | "manual" | "stream" | "recovery" | "request";

type XmtpConversationsContextValue = {
  conversations: ConversationSummary[];
  requestConversations: ConversationSummary[];
  requestCount: number;
  isLoading: boolean;
  unreadTotal: number;
  catchUpNewCount: number;
  lastSyncAt: number | null;
  refresh: () => void;
  dismissCatchUp: () => void;
  /** Optimistic local clear + protocol receipt (pending retry on failure). */
  markConversationSeen: (conversationId: string) => void;
  /** Accept / Block / send-promote — re-list both partitions from the protocol. */
  refreshConsentLists: () => void;
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
  const { account } = useActiveAccount();
  const evm = requireEvmSession(account);
  const address = evm.ok ? evm.address : undefined;
  const { client } = useMessagingSession();
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [requestConversations, setRequestConversations] = useState<ConversationSummary[]>(
    [],
  );
  const [isLoading, setIsLoading] = useState(false);
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null);
  const [catchUpNewCount, setCatchUpNewCount] = useState(0);

  const lastSyncAtRef = useRef<number | null>(null);
  const unreadTotalRef = useRef(0);
  const syncInFlightRef = useRef(false);
  const clientRef = useRef(client);
  clientRef.current = client;
  const addressRef = useRef(address);
  addressRef.current = address;
  const pendingReceiptsRef = useRef(new Set<string>());
  const deliveryHandleRef = useRef<InboxDeliveryHandle | null>(null);
  const recoveryInFlightRef = useRef(false);
  const autoRecoveryUsedRef = useRef(false);
  const openStreamsRef = useRef<((c: XmtpSdkClient) => Promise<void>) | null>(null);
  /** Cutover + relationship allow run on first attach and on new Unknown; not every stream message. */
  const cutoverDoneForClientRef = useRef<object | null>(null);

  const unreadTotal = useMemo(() => sumUnreadCounts(conversations), [conversations]);
  unreadTotalRef.current = unreadTotal;
  const requestCount = requestConversations.length;

  const persistPending = useCallback(() => {
    const addr = addressRef.current;
    if (!addr) return;
    writePendingReceipts(
      getMessagingXmtpEnv(),
      addr,
      pendingReceiptsRef.current,
    );
  }, []);

  const hydratePending = useCallback(() => {
    const addr = addressRef.current;
    if (!addr) {
      pendingReceiptsRef.current = new Set();
      return;
    }
    pendingReceiptsRef.current = new Set(
      readPendingReceipts(getMessagingXmtpEnv(), addr),
    );
  }, []);

  const dismissCatchUp = useCallback(() => {
    setCatchUpNewCount(0);
    if (typeof window !== "undefined") {
      sessionStorage.setItem(CATCH_UP_DISMISSED_KEY, "1");
    }
  }, []);

  const flushPendingReceipts = useCallback(
    async (activeClient: XmtpSdkClient) => {
      const pending = [...pendingReceiptsRef.current];
      for (const conversationId of pending) {
        const result = await markConversationRead(activeClient, conversationId);
        if (result.ok) pendingReceiptsRef.current.delete(conversationId);
      }
      persistPending();
    },
    [persistPending],
  );

  const runSync = useCallback(
    async (trigger: SyncTrigger) => {
      const activeClient = clientRef.current;
      if (!activeClient) return;
      if (syncInFlightRef.current) return;

      syncInFlightRef.current = true;
      const preUnread = unreadTotalRef.current;
      const trackCatchUp = trigger === "recovery" || trigger === "manual";

      const applyCutoverAndRelationship =
        cutoverDoneForClientRef.current !== activeClient ||
        trigger === "request" ||
        trigger === "client";

      setIsLoading(true);
      try {
        await flushPendingReceipts(activeClient);
        let userAddress: `0x${string}` | null = null;
        if (addressRef.current) {
          try {
            userAddress = getAddress(addressRef.current);
          } catch {
            userAddress = null;
          }
        }
        const { conversations: inbox, requestConversations: requests } =
          await loadConsentPartitionedSummaries(activeClient, {
            userAddress,
            applyCutoverAndRelationship,
          });
        if (applyCutoverAndRelationship) {
          cutoverDoneForClientRef.current = activeClient;
        }
        const newUnread = sumUnreadCounts(inbox);
        setConversations(inbox);
        setRequestConversations(requests);
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
        setRequestConversations([]);
      } finally {
        syncInFlightRef.current = false;
        setIsLoading(false);
      }
    },
    [flushPendingReceipts],
  );

  const markConversationSeen = useCallback(
    (conversationId: string) => {
      setConversations((prev) =>
        prev.map((row) =>
          row.id === conversationId ? { ...row, unreadCount: 0 } : row,
        ),
      );
      const activeClient = clientRef.current;
      if (!activeClient) {
        pendingReceiptsRef.current.add(conversationId);
        persistPending();
        return;
      }
      void markConversationRead(activeClient, conversationId).then((result) => {
        if (!result.ok) pendingReceiptsRef.current.add(conversationId);
        else pendingReceiptsRef.current.delete(conversationId);
        persistPending();
      });
    },
    [persistPending],
  );

  const openStreams = useCallback(
    async (activeClient: XmtpSdkClient) => {
      if (deliveryHandleRef.current) {
        await deliveryHandleRef.current.end();
        deliveryHandleRef.current = null;
      }

      const handle = await openInboxDeliveryStreams(activeClient, {
        onConversation: () => {
          void runSync("stream");
        },
        onRequestConversation: () => {
          void runSync("request");
        },
        onMessage: () => {
          void runSync("stream");
        },
        onConsentChange: () => {
          void runSync("stream");
        },
        onFail: () => {
          if (recoveryInFlightRef.current || autoRecoveryUsedRef.current) return;
          autoRecoveryUsedRef.current = true;
          recoveryInFlightRef.current = true;
          void (async () => {
            try {
              await runSync("recovery");
              const still = clientRef.current;
              if (still && openStreamsRef.current) {
                await openStreamsRef.current(still);
              }
            } catch {
              // Re-open failed — wait for manual refresh (no polling).
            } finally {
              recoveryInFlightRef.current = false;
            }
          })();
        },
      });
      deliveryHandleRef.current = handle;
    },
    [runSync],
  );
  openStreamsRef.current = openStreams;

  const refresh = useCallback(() => {
    autoRecoveryUsedRef.current = false;
    void (async () => {
      await runSync("manual");
      const still = clientRef.current;
      if (still) await openStreams(still);
    })();
  }, [runSync, openStreams]);

  const refreshConsentLists = useCallback(() => {
    void runSync("stream");
  }, [runSync]);

  useEffect(() => {
    if (!client) {
      setConversations([]);
      setRequestConversations([]);
      setIsLoading(false);
      setLastSyncAt(null);
      setCatchUpNewCount(0);
      lastSyncAtRef.current = null;
      cutoverDoneForClientRef.current = null;
      autoRecoveryUsedRef.current = false;
      const handle = deliveryHandleRef.current;
      deliveryHandleRef.current = null;
      if (handle) void handle.end();
      return;
    }

    let cancelled = false;
    autoRecoveryUsedRef.current = false;
    hydratePending();
    void (async () => {
      await runSync("client");
      if (cancelled || clientRef.current !== client) return;
      await openStreams(client);
    })();

    return () => {
      cancelled = true;
      const handle = deliveryHandleRef.current;
      deliveryHandleRef.current = null;
      if (handle) void handle.end();
    };
  }, [client, runSync, openStreams, hydratePending]);

  const value = useMemo(
    () => ({
      conversations,
      requestConversations,
      requestCount,
      isLoading,
      unreadTotal,
      catchUpNewCount,
      lastSyncAt,
      refresh,
      dismissCatchUp,
      markConversationSeen,
      refreshConsentLists,
    }),
    [
      conversations,
      requestConversations,
      requestCount,
      isLoading,
      unreadTotal,
      catchUpNewCount,
      lastSyncAt,
      refresh,
      dismissCatchUp,
      markConversationSeen,
      refreshConsentLists,
    ],
  );

  return (
    <XmtpConversationsContext.Provider value={value}>
      {children}
    </XmtpConversationsContext.Provider>
  );
}

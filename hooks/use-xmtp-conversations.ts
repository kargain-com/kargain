"use client";

import { SortDirection } from "@xmtp/client";
import { useCallback, useEffect, useState } from "react";

import type { XmtpClient } from "@/lib/xmtp/helpers";
import {
  dateToSentAfterNs,
  ethereumAddressFromInboxState,
  getLastSeen,
  messageText,
  truncatePreview,
} from "@/lib/xmtp/helpers";

export type ConversationSummary = {
  id: string;
  peerAddress: string;
  lastMessage: string | null;
  lastMessageAt: Date | null;
  unreadCount: number;
};

async function buildConversationSummary(
  client: XmtpClient,
  dm: Awaited<ReturnType<XmtpClient["conversations"]["listDms"]>>[number],
): Promise<ConversationSummary> {
  const peerInboxId = await dm.peerInboxId();
  const inboxStates = await client.preferences.getInboxStates([peerInboxId]);
  const peerAddress =
    ethereumAddressFromInboxState(inboxStates[0]) ?? peerInboxId;

  const last = await dm.lastMessage();
  const lastMessage = last ? truncatePreview(messageText(last)) : null;
  const lastMessageAt = last?.sentAt ?? null;

  const lastSeen = getLastSeen(dm.id);
  let unreadCount = 0;
  if (client.inboxId) {
    const options = lastSeen
      ? { sentAfterNs: dateToSentAfterNs(lastSeen), excludeSenderInboxIds: [client.inboxId] }
      : { excludeSenderInboxIds: [client.inboxId] };
    unreadCount = Number(await dm.countMessages(options));
  }

  return {
    id: dm.id,
    peerAddress,
    lastMessage,
    lastMessageAt,
    unreadCount,
  };
}

export function useXmtpConversations(client: XmtpClient | null): {
  conversations: ConversationSummary[];
  isLoading: boolean;
  refresh: () => void;
} {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);

  const refresh = useCallback(() => {
    setRefreshToken((value) => value + 1);
  }, []);

  useEffect(() => {
    if (!client) {
      setConversations([]);
      setIsLoading(false);
      return;
    }

    let cancelled = false;

    const load = async () => {
      setIsLoading(true);
      try {
        await client.conversations.sync();
        const dms = await client.conversations.listDms();
        const summaries = await Promise.all(
          dms.map((dm) => buildConversationSummary(client, dm)),
        );
        summaries.sort((a, b) => {
          const aTime = a.lastMessageAt?.getTime() ?? 0;
          const bTime = b.lastMessageAt?.getTime() ?? 0;
          return bTime - aTime;
        });
        if (!cancelled) setConversations(summaries);
      } catch {
        if (!cancelled) setConversations([]);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [client, refreshToken]);

  useEffect(() => {
    const onLastSeenUpdated = () => refresh();
    window.addEventListener("xmtp:lastseen-updated", onLastSeenUpdated);
    return () => window.removeEventListener("xmtp:lastseen-updated", onLastSeenUpdated);
  }, [refresh]);

  return { conversations, isLoading, refresh };
}

export function useXmtpUnreadTotal(client: XmtpClient | null): number {
  const { conversations } = useXmtpConversations(client);
  if (!client) return 0;
  return conversations.reduce((sum, conversation) => sum + conversation.unreadCount, 0);
}

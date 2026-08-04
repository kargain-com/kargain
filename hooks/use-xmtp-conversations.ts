"use client";

import { useXmtpConversationsContext } from "@/components/providers/xmtp-conversations-provider";
import type { ConversationSummary } from "@/lib/messaging/conversations";

export type { ConversationSummary };

export function useXmtpConversations(): {
  conversations: ConversationSummary[];
  requestConversations: ConversationSummary[];
  requestCount: number;
  isLoading: boolean;
  refresh: () => void;
  markConversationSeen: (conversationId: string) => void;
  refreshConsentLists: () => void;
} {
  const {
    conversations,
    requestConversations,
    requestCount,
    isLoading,
    refresh,
    markConversationSeen,
    refreshConsentLists,
  } = useXmtpConversationsContext();
  return {
    conversations,
    requestConversations,
    requestCount,
    isLoading,
    refresh,
    markConversationSeen,
    refreshConsentLists,
  };
}

export function useXmtpUnreadTotal(): number {
  const { unreadTotal } = useXmtpConversationsContext();
  return unreadTotal;
}

export function useXmtpRequestCount(): number {
  const { requestCount } = useXmtpConversationsContext();
  return requestCount;
}

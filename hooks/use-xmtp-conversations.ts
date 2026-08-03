"use client";

import { useXmtpConversationsContext } from "@/components/providers/xmtp-conversations-provider";
import type { ConversationSummary } from "@/lib/messaging/conversations";

export type { ConversationSummary };

export function useXmtpConversations(): {
  conversations: ConversationSummary[];
  isLoading: boolean;
  refresh: () => void;
  markConversationSeen: (conversationId: string) => void;
} {
  const { conversations, isLoading, refresh, markConversationSeen } =
    useXmtpConversationsContext();
  return { conversations, isLoading, refresh, markConversationSeen };
}

export function useXmtpUnreadTotal(): number {
  const { unreadTotal } = useXmtpConversationsContext();
  return unreadTotal;
}

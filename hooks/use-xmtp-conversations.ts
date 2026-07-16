"use client";

import {
  useXmtpConversationsContext,
} from "@/components/providers/xmtp-conversations-provider";
import type { ConversationSummary } from "@/lib/messaging/conversations";

export type { ConversationSummary };

export function useXmtpConversations(): {
  conversations: ConversationSummary[];
  isLoading: boolean;
  refresh: () => void;
} {
  const { conversations, isLoading, refresh } = useXmtpConversationsContext();
  return { conversations, isLoading, refresh };
}

export function useXmtpUnreadTotal(): number {
  const { unreadTotal } = useXmtpConversationsContext();
  return unreadTotal;
}

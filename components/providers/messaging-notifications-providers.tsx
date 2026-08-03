"use client";

import type { ReactNode } from "react";

import { MessagingSessionProvider } from "@/components/providers/messaging-session-provider";
import { XmtpConversationsProvider } from "@/components/providers/xmtp-conversations-provider";
import { NotificationsProvider } from "@/hooks/use-notification-state";

export function MessagingNotificationsProviders({ children }: { children: ReactNode }) {
  return (
    <NotificationsProvider>
      <MessagingSessionProvider>
        <XmtpConversationsProvider>{children}</XmtpConversationsProvider>
      </MessagingSessionProvider>
    </NotificationsProvider>
  );
}

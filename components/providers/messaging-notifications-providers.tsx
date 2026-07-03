"use client";

import type { ReactNode } from "react";

import { XmtpConversationsProvider } from "@/components/providers/xmtp-conversations-provider";
import { NotificationsProvider } from "@/hooks/use-notification-state";

export function MessagingNotificationsProviders({ children }: { children: ReactNode }) {
  return (
    <NotificationsProvider>
      <XmtpConversationsProvider>{children}</XmtpConversationsProvider>
    </NotificationsProvider>
  );
}

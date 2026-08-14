"use client";

import type { ReactNode } from "react";

import { MessagingNotificationsProviders } from "@/components/providers/messaging-notifications-providers";
import { NostrKeyProvider } from "@/hooks/use-nostr-key";

/** Sole mount of Nostr + messaging/notifications providers (identity routes). */
export function IdentityProviders({ children }: { children: ReactNode }) {
  return (
    <NostrKeyProvider>
      <MessagingNotificationsProviders>{children}</MessagingNotificationsProviders>
    </NostrKeyProvider>
  );
}

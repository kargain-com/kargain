"use client";

import { useMessagingSession } from "@/hooks/use-messaging-session";
import { useXmtpUnreadTotal } from "@/hooks/use-xmtp-conversations";
import { needsMessagingSetupCard } from "@/lib/messaging/snapshot-ui";
import { cn } from "@/lib/utils";

type Props = {
  className?: string;
};

/** Nav indicator: setup-needed (amber) or unread messages (warm). */
export function MessagingNavStatus({ className }: Props) {
  const { snapshot, client } = useMessagingSession();
  const needsMessagingCard = needsMessagingSetupCard(snapshot);
  const unreadTotal = useXmtpUnreadTotal();

  if (needsMessagingCard) {
    return (
      <span
        className={cn("absolute size-1.5 rounded-full bg-status-warning", className)}
        aria-label="Finish message setup"
      />
    );
  }

  if (!client || unreadTotal <= 0) return null;

  return (
    <span
      className={cn("absolute size-1.5 rounded-full bg-accent-warm", className)}
      aria-label={`${unreadTotal} unread messages`}
    />
  );
}

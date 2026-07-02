"use client";

import { useXmtpClient } from "@/hooks/use-xmtp-client";
import { useMessagingStatus } from "@/hooks/use-messaging-status";
import { useXmtpUnreadTotal } from "@/hooks/use-xmtp-conversations";
import { cn } from "@/lib/utils";

type Props = {
  className?: string;
};

/** Nav indicator: setup-needed (amber) or unread messages (warm). */
export function MessagingNavStatus({ className }: Props) {
  const { needsSetup } = useMessagingStatus();
  const { client } = useXmtpClient();
  const unreadTotal = useXmtpUnreadTotal();

  if (needsSetup) {
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

"use client";

import { useMessagingSession } from "@/hooks/use-messaging-session";
import {
  useXmtpRequestCount,
  useXmtpUnreadTotal,
} from "@/hooks/use-xmtp-conversations";
import { needsMessagingSetupCard } from "@/lib/messaging/snapshot-ui";
import { cn } from "@/lib/utils";

type Props = {
  className?: string;
};

/**
 * Nav indicator: setup-needed (amber), unread Allowed (warm), or quiet Requests count.
 * accent-warm stays reserved for unread / verified trust — never for Requests.
 */
export function MessagingNavStatus({ className }: Props) {
  const { snapshot, client } = useMessagingSession();
  const needsMessagingCard = needsMessagingSetupCard(snapshot);
  const unreadTotal = useXmtpUnreadTotal();
  const requestCount = useXmtpRequestCount();

  if (needsMessagingCard) {
    return (
      <span
        className={cn("absolute size-1.5 rounded-full bg-status-warning", className)}
        aria-label="Finish message setup"
      />
    );
  }

  if (!client) return null;

  if (unreadTotal > 0) {
    return (
      <span
        className={cn("absolute size-1.5 rounded-full bg-accent-warm", className)}
        aria-label={`${unreadTotal} unread messages`}
      />
    );
  }

  if (requestCount > 0) {
    return (
      <span
        className={cn(
          "absolute -right-1 -top-1 min-w-3.5 rounded px-0.5 text-center font-mono text-[9px] leading-3.5 text-text-tertiary tabular-nums",
          className,
        )}
        aria-label={`${requestCount} message request${requestCount === 1 ? "" : "s"}`}
      >
        {requestCount > 99 ? "99+" : requestCount}
      </span>
    );
  }

  return null;
}

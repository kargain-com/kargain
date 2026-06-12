"use client";

import { useXmtpClient } from "@/hooks/use-xmtp-client";
import { useXmtpUnreadTotal } from "@/hooks/use-xmtp-conversations";
import { cn } from "@/lib/utils";

/** 6px accent dot when XMTP is ready and there are unread messages. */
export function XmtpUnreadBadge({ className }: { className?: string }) {
  const { client } = useXmtpClient();
  const unreadTotal = useXmtpUnreadTotal(client);

  if (!client || unreadTotal <= 0) return null;

  return (
    <span
      className={cn("absolute size-1.5 rounded-full bg-accent-warm", className)}
      aria-label={`${unreadTotal} unread messages`}
    />
  );
}

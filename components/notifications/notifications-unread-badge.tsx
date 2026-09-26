"use client";

import { useUnreadAlertsFact } from "@/hooks/use-unread-notifications-count";
import { cn } from "@/lib/utils";

/** 6px accent dot when there is a known unread count > 0. */
export function NotificationsUnreadBadge({ className }: { className?: string }) {
  const fact = useUnreadAlertsFact();
  if (fact.status !== "known" || fact.count <= 0) return null;

  return (
    <span
      className={cn("absolute size-1.5 rounded-full bg-accent-warm", className)}
      aria-label={`${fact.count} unread alerts`}
    />
  );
}

"use client";

import { useAccount } from "wagmi";

import { useUnreadNotificationsCount } from "@/hooks/use-unread-notifications-count";
import { cn } from "@/lib/utils";

/** 6px accent dot when there are unread notifications. */
export function NotificationsUnreadBadge({ className }: { className?: string }) {
  const { isConnected } = useAccount();
  const unreadCount = useUnreadNotificationsCount();

  if (!isConnected || unreadCount <= 0) return null;

  return (
    <span
      className={cn("absolute size-1.5 rounded-full bg-accent-warm", className)}
      aria-label={`${unreadCount} unread alerts`}
    />
  );
}

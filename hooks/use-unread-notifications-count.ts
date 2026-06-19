"use client";

import { useNotificationsFeed } from "@/hooks/use-notifications-feed";

export function useUnreadNotificationsCount(): number {
  return useNotificationsFeed().unreadCount;
}

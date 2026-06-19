"use client";

import { useNotificationsFeedContext } from "@/hooks/use-notification-state";

export function useNotificationsFeed() {
  return useNotificationsFeedContext();
}

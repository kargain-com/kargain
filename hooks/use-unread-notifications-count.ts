"use client";

import { useActiveAccount } from "@/hooks/use-active-account";

import { useNotificationsFeed } from "@/hooks/use-notifications-feed";
import type { UnreadAlertsFact } from "@/lib/notifications/unread-alerts-fact";
import {
  admitSessionSurface,
  isSurfaceAdmissionAvailable,
} from "@/lib/web3/surface-admission";

/**
 * Typed unread-alerts count for chrome badges.
 * Admits `nostr_identity` first — family refusal never invents count 0.
 */
export function useUnreadAlertsFact(): UnreadAlertsFact {
  const { account } = useActiveAccount();
  const admission = admitSessionSurface(account, "nostr_identity");
  const feed = useNotificationsFeed();

  if (!isSurfaceAdmissionAvailable(admission)) {
    return { status: "refused", refusal: admission };
  }
  if (feed.isLoading) {
    return { status: "pending" };
  }
  return { status: "known", count: feed.unreadCount };
}

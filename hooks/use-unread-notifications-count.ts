"use client";

import { useActiveAccount } from "@/hooks/use-active-account";

import { useNotificationsFeed } from "@/hooks/use-notifications-feed";
import type { UnreadAlertsFact } from "@/lib/notifications/unread-alerts-fact";
import { admitSessionSurface } from "@/lib/web3/surface-admission";

/**
 * Typed unread-alerts count for chrome badges.
 * Admits `nostr_identity` first — family refusal never invents count 0.
 */
export function useUnreadAlertsFact(): UnreadAlertsFact {
  const { account } = useActiveAccount();
  const admission = admitSessionSurface(account, "nostr_identity");
  const feed = useNotificationsFeed();

  switch (admission.status) {
    case "disconnected":
      return { status: "refused", cause: "disconnected" };
    case "unresolved_namespace":
      return { status: "refused", cause: "unresolved_namespace" };
    case "support_refused":
      return { status: "refused", cause: admission.cause };
    case "family_required":
      return { status: "refused", cause: "family_required" };
    case "wrong_family":
      return { status: "refused", cause: "family_required" };
    case "available":
      if (feed.isLoading) {
        return { status: "pending" };
      }
      return { status: "known", count: feed.unreadCount };
  }
}

"use client";

import { Bell } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import { useAccount } from "wagmi";

import { NotificationRow, NotificationRowSkeletonList } from "@/components/notifications/notification-row";
import { WalletLoginButton } from "@/components/wallet-login-button";
import { useNotificationsFeed } from "@/hooks/use-notifications-feed";

import type { NotificationItem } from "@/lib/notifications/types";

function groupLabel(groupKey: string, items: NotificationItem[]) {
  const first = items[0];
  if (first?.subject.tokenId) return `Passport #${first.subject.tokenId}`;
  if (groupKey.startsWith("passport:")) {
    return `Passport #${groupKey.slice("passport:".length)}`;
  }
  return "Activity";
}

export function NotificationsClient() {
  const { isConnected } = useAccount();
  const { items, unreadCount, isLoading, markRead } = useNotificationsFeed();
  const markedOnMountRef = useRef(false);

  const grouped = useMemo(() => {
    const groups = new Map<string, typeof items>();
    for (const item of items) {
      const list = groups.get(item.groupKey) ?? [];
      list.push(item);
      groups.set(item.groupKey, list);
    }
    return [...groups.entries()].map(([groupKey, groupItems]) => ({
      groupKey,
      items: groupItems,
      label: groupLabel(groupKey, groupItems),
    }));
  }, [items]);

  useEffect(() => {
    if (!isConnected || items.length === 0 || markedOnMountRef.current) return;

    const timer = window.setTimeout(() => {
      const maxTimestamp = Math.max(...items.map((item) => item.timestamp));
      markRead(["ponder", "nostr"], maxTimestamp);
      markedOnMountRef.current = true;
    }, 500);

    return () => window.clearTimeout(timer);
  }, [isConnected, items, markRead]);

  if (!isConnected) {
    return (
      <div className="mt-8 space-y-3 rounded-md border border-border-default bg-bg-surface p-4">
        <p className="font-sans text-sm text-text-secondary">
          Connect your wallet to see alerts from your passports and watchlist.
        </p>
        <WalletLoginButton />
      </div>
    );
  }

  return (
    <div className="mt-8 space-y-4">
      {unreadCount > 0 && (
        <div className="flex justify-end">
          <button
            type="button"
            className="font-sans text-sm text-text-secondary transition-colors duration-150 hover:text-text-primary"
            onClick={() => markRead(["ponder", "nostr", "watchlist"], Math.floor(Date.now() / 1000))}
          >
            Mark all read
          </button>
        </div>
      )}

      {isLoading && <NotificationRowSkeletonList count={3} />}

      {!isLoading && items.length === 0 && (
        <div className="py-8 text-center">
          <Bell size={48} strokeWidth={1} className="mx-auto text-text-tertiary" aria-hidden />
          <h2 className="mt-4 font-display text-fluid-h2 font-medium text-text-primary">
            No alerts yet
          </h2>
          <p className="mx-auto mt-2 max-w-sm font-sans text-sm text-text-secondary">
            Activity from your passports and watchlist will appear here.
          </p>
        </div>
      )}

      {!isLoading && items.length > 0 && (
        <div className="space-y-6">
          {grouped.map(({ groupKey, items: groupItems, label }) => (
            <section key={groupKey}>
              <h2 className="mb-2 font-sans text-xs text-text-secondary">{label}</h2>
              <ul className="overflow-hidden rounded-md border border-border-default bg-bg-card">
                {groupItems.map((item, index) => (
                  <NotificationRow
                    key={item.id}
                    item={item}
                    isLast={index === groupItems.length - 1}
                  />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

"use client";

import { Bell } from "lucide-react";
import { useMemo } from "react";
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
      <div className="flex items-center justify-between">
        {isConnected && unreadCount > 0 && (
          <button
            type="button"
            className="ml-auto font-sans text-xs text-text-secondary transition-colors duration-150 hover:text-text-primary focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]"
            onClick={() =>
              markRead(["ponder", "nostr", "watchlist"], Math.floor(Date.now() / 1000))
            }
          >
            Mark all read
          </button>
        )}
      </div>

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
                    onRead={() => markRead([item.source], item.timestamp)}
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

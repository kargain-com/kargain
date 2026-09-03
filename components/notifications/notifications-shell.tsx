"use client";

import { useActiveAccount, requireEvmSession } from "@/hooks/use-active-account";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect } from "react";

import { NotificationsClient } from "@/components/notifications/notifications-client";
import { WatchlistClient } from "@/components/watchlist/watchlist-client";
import { useNostrKey } from "@/hooks/use-nostr-key";
import { cn } from "@/lib/utils";

type TabId = "alerts" | "watchlist";

function tabFromSearchParams(searchParams: URLSearchParams): TabId {
  return searchParams.get("tab") === "watchlist" ? "watchlist" : "alerts";
}

/** Lazy Nostr key restore when user opens /notifications (repopulates pubkey cache). */
function NotificationsNostrBootstrap() {
  const { account } = useActiveAccount();
  const evm = requireEvmSession(account);
  const isConnected = evm.ok;
  const { ensureNostrKey } = useNostrKey();

  useEffect(() => {
    if (isConnected) void ensureNostrKey();
  }, [isConnected, ensureNostrKey]);

  return null;
}

export function NotificationsShell() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeTab = tabFromSearchParams(searchParams);

  const setTab = useCallback(
    (tab: TabId) => {
      const params = new URLSearchParams(searchParams.toString());
      if (tab === "watchlist") {
        params.set("tab", "watchlist");
      } else {
        params.delete("tab");
      }
      const query = params.toString();
      router.replace(query ? `/notifications?${query}` : "/notifications");
    },
    [router, searchParams],
  );

  return (
    <div className="mx-auto max-w-7xl xl:max-w-[80rem]">
      <NotificationsNostrBootstrap />
      <h1 className="mb-6 font-display text-fluid-h2 font-medium tracking-[-0.015em] leading-[1.15] text-text-primary">
        Notifications
      </h1>

      <div className="border-b border-border-default">
        <nav className="flex gap-6" aria-label="Notifications sections">
          <button
            type="button"
            onClick={() => setTab("alerts")}
            className={cn(
              "border-b-2 pb-3 font-sans text-sm transition-colors duration-150",
              activeTab === "alerts"
                ? "border-text-primary font-medium text-text-primary"
                : "border-transparent font-normal text-text-secondary hover:text-text-primary",
            )}
          >
            Alerts
          </button>
          <button
            type="button"
            onClick={() => setTab("watchlist")}
            className={cn(
              "border-b-2 pb-3 font-sans text-sm transition-colors duration-150",
              activeTab === "watchlist"
                ? "border-text-primary font-medium text-text-primary"
                : "border-transparent font-normal text-text-secondary hover:text-text-primary",
            )}
          >
            Watchlist
          </button>
        </nav>
      </div>

      {activeTab === "alerts" ? (
        <NotificationsClient />
      ) : (
        <WatchlistClient />
      )}
    </div>
  );
}

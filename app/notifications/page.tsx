import type { Metadata } from "next";

import { WatchlistClient } from "@/components/watchlist/watchlist-client";

export const metadata: Metadata = {
  title: "Watchlist",
};

export default function NotificationsPage() {
  return (
    <div className="min-h-dvh bg-bg-primary px-6 py-24 text-text-primary md:px-8">
      <WatchlistClient />
    </div>
  );
}

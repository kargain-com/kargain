import { formatPassportTitle } from "@/lib/passport/passport-token-id";
import { passportGroupKey } from "@/lib/notifications/id";
import type { WatchlistSnapshotDiff } from "@/lib/notifications/watchlist-snapshot";
import type { NotificationItem, NotificationType } from "@/lib/notifications/types";

const DIFF_TYPE_CONFIG: Record<
  WatchlistSnapshotDiff["changeType"],
  { type: NotificationType; body: string; priority: NotificationItem["priority"] }
> = {
  status_changed: {
    type: "watchlist.status_changed",
    body: "Status changed on a watched vehicle",
    priority: "normal",
  },
  listing_deactivated: {
    type: "watchlist.listing_deactivated",
    body: "A watched listing was removed from sale",
    priority: "normal",
  },
  price_changed: {
    type: "watchlist.price_changed",
    body: "Price changed on a watched vehicle",
    priority: "low",
  },
  dispute_opened: {
    type: "watchlist.dispute_opened",
    body: "A dispute was opened on a watched vehicle",
    priority: "high",
  },
};

export function mapWatchlistDiffs(
  diffs: WatchlistSnapshotDiff[],
  lastSeenAtWatchlist: number,
): NotificationItem[] {
  return diffs.map((diff) => {
    const config = DIFF_TYPE_CONFIG[diff.changeType];
    const timestamp = diff.new.capturedAt;

    return {
      id: `watchlist:${diff.changeType}:${diff.tokenId}:${diff.new.capturedAt}`,
      type: config.type,
      source: "watchlist",
      timestamp,
      read: timestamp <= lastSeenAtWatchlist,
      href: `/marketplace/${diff.tokenId}`,
      subject: {
        kind: "passport",
        tokenId: diff.tokenId,
        title: formatPassportTitle(diff.tokenId),
      },
      body: config.body,
      groupKey: passportGroupKey(diff.tokenId),
      priority: config.priority,
    };
  });
}

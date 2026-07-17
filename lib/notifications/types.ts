export type NotificationSource = "ponder" | "watchlist" | "nostr";

export type NotificationType =
  | "passport.verified"
  | "passport.dispute_opened"
  | "passport.dispute_resolved"
  | "passport.record_appended"
  | "passport.attestation_received"
  | "listing.sold"
  | "agent.authorized"
  | "auction_agent.authorized"
  | "verifier.dispute_on_verified"
  | "watchlist.status_changed"
  | "watchlist.listing_deactivated"
  | "watchlist.price_changed"
  | "watchlist.dispute_opened"
  | "nostr.comment_on_passport"
  | "nostr.reply_to_comment"
  | "nostr.like_on_comment";

export type NotificationItem = {
  id: string;
  type: NotificationType;
  source: NotificationSource;
  timestamp: number;
  read: boolean;
  href: string;
  subject: {
    kind: "passport" | "listing" | "comment";
    tokenId?: string;
    eventId?: string;
    title: string;
  };
  actor?: {
    address?: `0x${string}`;
    nostrPubkey?: string;
  };
  body: string;
  groupKey: string;
  priority: "low" | "normal" | "high";
};

export type PonderFeedItem = {
  id: string;
  type: string;
  tokenId: string;
  timestamp: string;
  actor?: string;
  meta?: Record<string, string | number | boolean>;
};

export type WatchlistSnapshot = {
  tokenId: string;
  status: string;
  active: boolean;
  fiatPrice1e8: string;
  updatedAt: string;
  capturedAt: number;
};

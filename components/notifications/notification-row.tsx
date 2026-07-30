"use client";

import Link from "next/link";

import {
  BookmarkIcon,
  CircleCheckIcon,
  CircleInformationIcon,
  CreditCardIcon,
  DocumentIcon,
  HeartIcon,
  MessageIcon,
  ReplyIcon,
  ShieldCheckIcon,
  ShieldIcon,
  ShieldWarningIcon,
  UserCheckIcon,
  WarningIcon,
  type IconComponent,
} from "@/components/ui/icons";
import { formatRelativeTime } from "@/lib/format/relative-time";
import type { NotificationItem, NotificationType } from "@/lib/notifications/types";
import { cn } from "@/lib/utils";

const ICON_BY_TYPE: Record<NotificationType, IconComponent> = {
  "passport.verified": ShieldCheckIcon,
  "passport.dispute_opened": ShieldWarningIcon,
  "passport.dispute_resolved": ShieldIcon,
  "passport.dispute_expired": CircleInformationIcon,
  "passport.record_appended": DocumentIcon,
  "passport.attestation_received": CircleCheckIcon,
  "mandate.granted": UserCheckIcon,
  "claim.recorded": CreditCardIcon,
  "verifier.dispute_on_verified": WarningIcon,
  "watchlist.status_changed": BookmarkIcon,
  "watchlist.listing_deactivated": BookmarkIcon,
  "watchlist.price_changed": BookmarkIcon,
  "watchlist.dispute_opened": BookmarkIcon,
  "nostr.comment_on_passport": MessageIcon,
  "nostr.reply_to_comment": ReplyIcon,
  "nostr.like_on_comment": HeartIcon,
};

type NotificationRowProps = {
  item: NotificationItem;
  isLast?: boolean;
  onRead?: () => void;
};

export function NotificationRow({ item, isLast = false, onRead }: NotificationRowProps) {
  const Icon = ICON_BY_TYPE[item.type];

  return (
    <li>
      <Link
        href={item.href}
        onClick={() => onRead?.()}
        className={cn(
          "flex items-start gap-3 px-4 py-3 rounded-none hover:bg-bg-surface transition-colors duration-150",
          !isLast && "border-b border-border-default",
          !item.read && "border-l-2 border-accent-warm",
        )}
      >
        <Icon size={18} className="mt-0.5 shrink-0 text-text-secondary" aria-hidden />
        <div className="min-w-0 flex-1">
          <p
            className={cn(
              "line-clamp-2 font-sans text-sm",
              item.read ? "text-text-secondary" : "text-text-primary",
            )}
          >
            {item.body}
          </p>
          <p className="mt-1 font-mono text-xs text-text-tertiary tabular-nums">
            {formatRelativeTime(new Date(item.timestamp * 1000))}
          </p>
        </div>
      </Link>
    </li>
  );
}

function NotificationRowSkeleton() {
  return (
    <li className="animate-pulse border-b border-border-default px-4 py-3">
      <div className="flex items-start gap-3">
        <div className="size-[18px] rounded bg-bg-surface" />
        <div className="flex-1 space-y-2">
          <div className="h-4 w-3/4 rounded bg-bg-surface" />
          <div className="h-3 w-1/4 rounded bg-bg-surface" />
        </div>
      </div>
    </li>
  );
}

export function NotificationRowSkeletonList({ count = 3 }: { count?: number }) {
  return (
    <ul className="overflow-hidden rounded-md border border-border-default bg-bg-card">
      {Array.from({ length: count }).map((_, index) => (
        <NotificationRowSkeleton key={index} />
      ))}
    </ul>
  );
}

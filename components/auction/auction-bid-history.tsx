"use client";

import { EnsWalletLink } from "@/components/ui/ens-wallet-link";
import {
  formatAuctionAmount,
} from "@/lib/auction/format-auction";
import type { AuctionBid } from "@/lib/auction/map-ponder-auction";
import { cn } from "@/lib/utils";

type Props = {
  bids: AuctionBid[];
  assetLabel: "ETH" | "USDC";
  className?: string;
};

function formatBidTime(ts: bigint): string {
  const sec = Number(ts);
  if (!Number.isFinite(sec) || sec <= 0) return "";
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(sec * 1000));
}

export function AuctionBidHistory({ bids, assetLabel, className }: Props) {
  if (bids.length === 0) {
    return (
      <p className={cn("font-sans text-sm text-text-secondary", className)}>
        No bids yet.
      </p>
    );
  }

  // Newest first (API + filter preserve order; sort defensively)
  const sorted = [...bids].sort((a, b) => {
    if (a.timestamp === b.timestamp) return 0;
    return a.timestamp > b.timestamp ? -1 : 1;
  });

  return (
    <div className={cn("space-y-2", className)}>
      <p className="font-mono text-[10.5px] font-medium uppercase tracking-[0.14em] text-text-tertiary">
        Bid history
      </p>
      <ul className="divide-y divide-border-default rounded-md border border-border-default">
        {sorted.map((bid) => (
          <li
            key={bid.id}
            className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-3 py-2.5"
          >
            <EnsWalletLink
              address={bid.bidder}
              className="font-mono text-xs text-text-secondary"
            />
            <span className="font-mono text-sm tabular-nums text-text-primary">
              {formatAuctionAmount(bid.amount, assetLabel)}
            </span>
            <time
              dateTime={new Date(Number(bid.timestamp) * 1000).toISOString()}
              className="w-full font-mono text-[11px] tabular-nums text-text-tertiary sm:w-auto"
            >
              {formatBidTime(bid.timestamp)}
            </time>
          </li>
        ))}
      </ul>
    </div>
  );
}

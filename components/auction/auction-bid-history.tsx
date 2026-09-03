"use client";

import { EnsWalletLink } from "@/components/ui/ens-wallet-link";
import { InstrumentTimeline } from "@/components/ui/instrument-timeline";
import {
  formatAuctionAmount,
} from "@/lib/auction/format-auction";
import type { AuctionBid } from "@/lib/auction/map-ponder-auction";
import { cn } from "@/lib/utils";
import {
  commercialActive,
  nativeUnitOf,
} from "@/lib/web3/commercial-active";

type Props = {
  bids: AuctionBid[];
  assetLabel: "ETH" | "USDC";
  chainId: number;
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

export function AuctionBidHistory({
  bids,
  assetLabel,
  chainId,
  className,
}: Props) {
  if (bids.length === 0) {
    return (
      <p className={cn("font-sans text-sm text-text-secondary", className)}>
        No bids yet.
      </p>
    );
  }

  const nativeUnit = nativeUnitOf(commercialActive(chainId)!);

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
      <InstrumentTimeline>
        {sorted.map((bid) => (
          <InstrumentTimeline.Item
            key={bid.id}
            tickLabel={
              <time
                dateTime={new Date(Number(bid.timestamp) * 1000).toISOString()}
              >
                {formatBidTime(bid.timestamp)}
              </time>
            }
          >
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 rounded-md border border-border-default bg-bg-primary/80 px-3 py-2.5">
              <EnsWalletLink
                address={bid.bidder}
                className="font-mono text-xs text-text-secondary"
              />
              <span className="font-mono text-sm tabular-nums text-text-primary">
                {formatAuctionAmount(bid.amount, assetLabel, nativeUnit)}
              </span>
            </div>
          </InstrumentTimeline.Item>
        ))}
      </InstrumentTimeline>
    </div>
  );
}

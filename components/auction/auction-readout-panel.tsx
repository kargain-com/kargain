"use client";

import type { ReactNode } from "react";

import { minNextBid } from "@/lib/auction/auction-bid-math";
import {
  endsAtDateTimeAttr,
  formatAuctionAmount,
  formatAuctionCountdownSeconds,
} from "@/lib/auction/format-auction";
import {
  auctionPhaseLabel,
  type AuctionRow,
  type AuctionUiState,
} from "@/lib/auction/map-ponder-auction";
import { instrumentReadoutPanel } from "@/lib/design/instrument-classes";
import { cn } from "@/lib/utils";

type Props = {
  auction: AuctionRow;
  uiState: AuctionUiState;
  now: number;
  minIncrementBps: number;
  className?: string;
};

function ReadoutRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2 first:pt-0 last:pb-0">
      <dt className="font-mono text-[10.5px] font-medium uppercase tracking-[0.14em] text-text-tertiary">
        {label}
      </dt>
      <dd className="min-w-0 text-right font-mono text-sm tabular-nums text-text-primary">
        {children}
      </dd>
    </div>
  );
}

export function AuctionReadoutPanel({
  auction,
  uiState,
  now,
  minIncrementBps,
  className,
}: Props) {
  const minNext = minNextBid(auction.highestBid, minIncrementBps, auction.reserve);
  const hasBid = auction.highestBid > 0n && auction.startedAt > 0n;
  const endsAttr = endsAtDateTimeAttr(auction.endsAt);
  const countdown =
    auction.endsAt > 0n
      ? formatAuctionCountdownSeconds(auction.endsAt, now)
      : null;

  return (
    <div className={cn(instrumentReadoutPanel, className)}>
      <dl className="divide-y divide-border-default">
        <ReadoutRow label="Phase">{auctionPhaseLabel(uiState)}</ReadoutRow>
        <ReadoutRow label="Reserve">
          {formatAuctionAmount(auction.reserve, auction.assetLabel)}
        </ReadoutRow>
        <ReadoutRow label="Current bid">
          {hasBid
            ? formatAuctionAmount(auction.highestBid, auction.assetLabel)
            : "—"}
        </ReadoutRow>
        {(uiState === "S1" || uiState === "S3" || uiState === "S4") && (
          <ReadoutRow label="Min next bid">
            {formatAuctionAmount(minNext, auction.assetLabel)}
          </ReadoutRow>
        )}
        <ReadoutRow label="Asset">{auction.assetLabel}</ReadoutRow>
        {uiState === "S1" && auction.startedAt === 0n ? (
          <ReadoutRow label="Ends in">Awaiting first bid</ReadoutRow>
        ) : countdown && endsAttr ? (
          <ReadoutRow label="Ends in">
            <time dateTime={endsAttr}>{countdown}</time>
          </ReadoutRow>
        ) : uiState === "S5" ? (
          <ReadoutRow label="Ends in">Ended</ReadoutRow>
        ) : null}
      </dl>
    </div>
  );
}

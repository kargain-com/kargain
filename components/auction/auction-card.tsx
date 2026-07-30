"use client";

import Link from "next/link";
import { UserIcon } from "@/components/ui/icons";

import { PassportIdLabel } from "@/components/passport/passport-id-label";
import { Card, CardContent } from "@/components/ui/card";
import { PassportStatusBadge } from "@/components/ui/passport-status-badge";
import {
  formatAuctionAmount,
  formatAuctionCountdownMinutes,
  endsAtDateTimeAttr,
} from "@/lib/auction/format-auction";
import type { AuctionRow } from "@/lib/auction/map-ponder-auction";
import {
  LISTING_CARD_IMAGE,
  LISTING_CARD_IMAGE_FRAME,
  LISTING_CARD_IMAGE_PLACEHOLDER,
} from "@/lib/marketplace/listing-card-media";
import { cn } from "@/lib/utils";
import { shortAddress } from "@/lib/web3/wallet-display";

type Props = {
  row: AuctionRow;
  /** Shared minute-granularity wall clock (unix seconds). */
  now: number;
};

export function AuctionCard({ row, now }: Props) {
  const hasBid = row.highestBid > 0n && row.startedAt > 0n;
  const awaitingFirstBid = row.startedAt === 0n;
  const priceLabel = hasBid
    ? formatAuctionAmount(row.highestBid, row.assetLabel)
    : formatAuctionAmount(row.reserve, row.assetLabel);
  const countdown = awaitingFirstBid
    ? null
    : formatAuctionCountdownMinutes(row.endsAt, now);
  const endsAttr = endsAtDateTimeAttr(row.endsAt);

  return (
    <Link
      href={`/marketplace/${row.tokenId}?chain=${row.chainId}`}
      className="group flex h-full focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]"
    >
      <Card
        className={cn(
          "flex h-full w-full flex-col overflow-hidden bg-bg-card p-0 transition-colors duration-300",
          row.passportStatus === "VERIFIED"
            ? "border-accent-warm group-focus-visible:border-accent-warm"
            : "border-border-default hover:border-border-hover group-focus-visible:border-border-hover",
        )}
      >
        <div className={LISTING_CARD_IMAGE_FRAME}>
          {row.imageUrl ? (
            <img
              src={row.imageUrl}
              alt={row.title}
              className={LISTING_CARD_IMAGE}
              loading="lazy"
            />
          ) : (
            <div className={LISTING_CARD_IMAGE_PLACEHOLDER}>No image</div>
          )}
        </div>
        <CardContent className="flex flex-1 flex-col gap-2 p-6">
          <div className="flex items-start justify-between gap-2">
            <h2 className="min-w-0 font-sans text-sm font-medium text-text-primary line-clamp-2">
              {row.title}
            </h2>
            <PassportStatusBadge
              status={row.passportStatus}
              className="shrink-0"
            />
          </div>
          <PassportIdLabel
            tokenId={row.tokenId}
            chainId={row.chainId}
            variant="eyebrow"
          />
          <div className="mt-auto space-y-1 pt-2">
            <p className="font-mono text-base font-medium tabular-nums text-text-primary">
              {priceLabel}
            </p>
            {!hasBid && (
              <p className="font-sans text-xs text-text-secondary">
                Reserve not met
              </p>
            )}
            {awaitingFirstBid ? (
              <p className="font-sans text-xs text-text-secondary">
                Awaiting first bid
              </p>
            ) : countdown && endsAttr ? (
              <time
                dateTime={endsAttr}
                className="block font-mono text-xs tabular-nums text-text-secondary"
              >
                {countdown}
              </time>
            ) : null}
            {row.agent ? (
              <div className="flex items-center gap-1.5 pt-1">
                <UserIcon
                  size={12}
                  className="shrink-0 text-text-tertiary"
                  aria-hidden
                />
                <p className="font-sans text-xs text-text-secondary truncate">
                  Listed by{" "}
                  <span className="font-mono text-text-secondary">
                    {shortAddress(row.agent)}
                  </span>
                </p>
              </div>
            ) : null}
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

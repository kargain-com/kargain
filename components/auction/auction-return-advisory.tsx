"use client";

import {
  elevatedAdvisoryPanel,
  elevatedAdvisoryText,
  monoTimestamp,
} from "@/lib/design/instrument-classes";
import { RETURN_COOLDOWN_SECONDS } from "@/lib/marketplace/return-cooldown";
import { cn } from "@/lib/utils";

type Props = {
  returnRequestedAt: bigint;
};

/**
 * U7 / S2 — elevated advisory for all viewers when owner requested return
 * and the auction has not started (`startedAt == 0`). Caller gates visibility.
 */
export function AuctionReturnAdvisory({ returnRequestedAt }: Props) {
  if (returnRequestedAt <= 0n) return null;

  const cancelEligibleAt = returnRequestedAt + RETURN_COOLDOWN_SECONDS;
  const date = new Date(Number(cancelEligibleAt) * 1000);
  const dateLabel = date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
  const dateTimeAttr = date.toISOString();

  return (
    <div className={elevatedAdvisoryPanel} role="status">
      <p className={cn("font-sans", elevatedAdvisoryText)}>
        The owner has asked for this vehicle back. If no one bids before{" "}
        <time
          dateTime={dateTimeAttr}
          className={cn(monoTimestamp, elevatedAdvisoryText)}
        >
          {dateLabel}
        </time>
        , the auction can be cancelled. A qualifying bid before then completes
        the sale.
      </p>
    </div>
  );
}

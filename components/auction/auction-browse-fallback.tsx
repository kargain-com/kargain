import { AuctionCardSkeleton } from "@/components/auction/auction-card-skeleton";
import {
  LISTING_CARD_GRID_WIDE,
  MARKETPLACE_SHELL_CONTAINER,
} from "@/lib/marketplace/listing-card-grid";
import { cn } from "@/lib/utils";

export function AuctionBrowseFallback() {
  return (
    <div className={cn(MARKETPLACE_SHELL_CONTAINER, "pb-16")} role="status">
      <p className="sr-only">Loading auctions…</p>
      <ul className={LISTING_CARD_GRID_WIDE}>
        {Array.from({ length: 6 }, (_, i) => (
          <li key={i} className="min-h-0">
            <AuctionCardSkeleton />
          </li>
        ))}
      </ul>
    </div>
  );
}

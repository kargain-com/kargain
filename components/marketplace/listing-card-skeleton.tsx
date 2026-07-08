import { LISTING_CARD_IMAGE_FRAME } from "@/lib/marketplace/listing-card-media";
import { cn } from "@/lib/utils";

export function ListingCardSkeleton() {
  return (
    <div className="h-full overflow-hidden rounded-md border border-border-default bg-bg-card">
      <div className={cn(LISTING_CARD_IMAGE_FRAME, "animate-pulse")} />
      <div className="space-y-2.5 p-6">
        <div className="h-4 w-3/4 animate-pulse rounded bg-bg-surface" />
        <div className="h-3 w-1/2 animate-pulse rounded bg-bg-surface" />
        <div className="h-6 w-1/3 animate-pulse rounded bg-bg-surface" />
      </div>
    </div>
  );
}

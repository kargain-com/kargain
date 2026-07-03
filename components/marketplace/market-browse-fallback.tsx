import { ListingCardSkeleton } from "@/components/marketplace/listing-card-skeleton";

export function MarketBrowseFallback() {
  return (
    <div className="min-h-dvh bg-bg-primary text-text-primary">
      <div className="border-b border-border-default bg-bg-card">
        <div className="mx-auto flex max-w-7xl items-center gap-2 px-6 py-3 md:px-8 xl:max-w-[80rem]">
          <div className="h-11 min-w-0 flex-1 max-w-[240px] animate-pulse rounded-sm bg-bg-surface" />
          <div className="hidden h-11 w-24 animate-pulse rounded-sm bg-bg-surface md:block" />
          <div className="hidden h-11 w-24 animate-pulse rounded-sm bg-bg-surface md:block" />
        </div>
      </div>
      <div className="mx-auto max-w-7xl px-6 py-8 md:px-8 sm:py-10 xl:max-w-[80rem]">
        <ul
          className="mb-4 grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-3"
          role="status"
          aria-live="polite"
          aria-label="Loading listings"
        >
          {Array.from({ length: 6 }).map((_, i) => (
            <li key={i} aria-hidden>
              <ListingCardSkeleton />
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

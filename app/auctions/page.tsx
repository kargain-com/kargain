import { Suspense } from "react";

import { AuctionBrowseFallback } from "@/components/auction/auction-browse-fallback";
import { AuctionBrowseLoader } from "@/components/auction/auction-browse-loader";
import { MARKETPLACE_SHELL_CONTAINER } from "@/lib/marketplace/listing-card-grid";

export default function AuctionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <div className="min-h-dvh bg-bg-primary pt-8 md:pt-12">
      <div className={MARKETPLACE_SHELL_CONTAINER}>
        <h1 className="font-display text-fluid-display font-medium tracking-[-0.02em] text-text-primary">
          Auctions
        </h1>
        <p className="mt-2 max-w-xl font-sans text-sm text-text-secondary">
          Live reserve auctions for verified vehicles. Bids are held by the
          auction contract until you are outbid or you win.
        </p>
      </div>
      <div className="mt-8">
        <Suspense fallback={<AuctionBrowseFallback />}>
          <AuctionBrowseLoader searchParams={searchParams} />
        </Suspense>
      </div>
    </div>
  );
}

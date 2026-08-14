import { Suspense } from "react";

import { MarketBrowseFallback } from "@/components/marketplace/market-browse-fallback";
import { MarketBrowseLoader } from "@/components/marketplace/market-browse-loader";
import { MarketplaceStatsLine } from "@/components/marketplace/marketplace-stats-line";

export default function HomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <>
      <Suspense fallback={null}>
        <MarketplaceStatsLine />
      </Suspense>
      <Suspense fallback={<MarketBrowseFallback />}>
        <MarketBrowseLoader searchParams={searchParams} />
      </Suspense>
    </>
  );
}

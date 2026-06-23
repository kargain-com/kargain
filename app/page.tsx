import { Suspense } from "react";

import { MarketBrowse } from "@/components/marketplace/market-browse";
import { MarketplaceStatsLine } from "@/components/marketplace/marketplace-stats-line";
import { parseChainParam } from "@/lib/web3/parse-chain-param";

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ chain?: string | string[] }>;
}) {
  const sp = await searchParams;
  const initialChainId = parseChainParam(sp.chain);

  return (
    <>
      <Suspense fallback={null}>
        <MarketplaceStatsLine />
      </Suspense>
      <MarketBrowse initialChainId={initialChainId} />
    </>
  );
}

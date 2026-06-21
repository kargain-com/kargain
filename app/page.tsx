import { fetchMarketplaceStats } from "@/app/actions/marketplace-listings";
import { fetchActiveVerifierCount } from "@/app/actions/verifier-directory";
import { MarketBrowse } from "@/components/marketplace/market-browse";
import type { MarketplaceStatsResponse } from "@/lib/types/ponder";
import { parseChainParam } from "@/lib/web3/parse-chain-param";

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ chain?: string | string[] }>;
}) {
  const sp = await searchParams;
  const initialChainId = parseChainParam(sp.chain);

  let activeListings = 0;
  let verifiedCount = 0;
  let activeVerifiers = 0;

  try {
    const [statsRaw, verifierCount] = await Promise.all([
      fetchMarketplaceStats(),
      fetchActiveVerifierCount(),
    ]);
    const stats = statsRaw as MarketplaceStatsResponse | null;
    activeListings = stats?.totalActive ?? 0;
    activeVerifiers = verifierCount;
    verifiedCount = stats?.statusCounts?.VERIFIED ?? 0;
  } catch {
    // stats default to 0 — page still renders
  }

  return (
    <MarketBrowse
      initialChainId={initialChainId}
      activeListings={activeListings}
      verifiedCount={verifiedCount}
      activeVerifiers={activeVerifiers}
    />
  );
}

import { fetchActiveAuctionCount } from "@/app/actions/auction-browse";
import { fetchActiveVerifierCount } from "@/app/actions/verifier-directory";
import { fetchMarketplaceStats } from "@/app/actions/marketplace-listings";
import { MARKETPLACE_SHELL_CONTAINER } from "@/lib/marketplace/listing-card-grid";
import { formatMarketplaceStatsLine } from "@/lib/marketplace/marketplace-stats-line";
import type { MarketplaceStatsResponse } from "@/lib/types/ponder";
import { cn } from "@/lib/utils";

export async function MarketplaceStatsLine() {
  let listings = 0;
  let auctions = 0;
  let verified = 0;
  let activeVerifiers = 0;

  try {
    const [statsRaw, auctionCount, verifierCount] = await Promise.all([
      fetchMarketplaceStats(),
      fetchActiveAuctionCount(),
      fetchActiveVerifierCount(),
    ]);
    const stats = statsRaw as MarketplaceStatsResponse | null;
    listings = stats?.totalActive ?? 0;
    auctions = auctionCount;
    activeVerifiers = verifierCount;
    verified = stats?.statusCounts?.VERIFIED ?? 0;
  } catch {
    return null;
  }

  const line = formatMarketplaceStatsLine({
    listings,
    auctions,
    verified,
    activeVerifiers,
  });
  if (line == null) return null;

  return (
    <div className={cn(MARKETPLACE_SHELL_CONTAINER, "pt-4 pb-0")}>
      <p className="font-mono text-xs text-text-tertiary tabular-nums">{line}</p>
    </div>
  );
}

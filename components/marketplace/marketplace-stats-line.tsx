import { fetchActiveAuctionCount } from "@/app/actions/auction-browse";
import { fetchLiveConsignmentBrowseStats } from "@/app/actions/commerce-consignments";
import { fetchActiveVerifierCount } from "@/app/actions/verifier-directory";
import { MARKETPLACE_SHELL_CONTAINER } from "@/lib/marketplace/listing-card-grid";
import { formatMarketplaceStatsLine } from "@/lib/marketplace/marketplace-stats-line";
import { cn } from "@/lib/utils";

export async function MarketplaceStatsLine() {
  let listings = 0;
  let auctions = 0;
  let verified = 0;
  let activeVerifiers = 0;

  try {
    const [browseStats, auctionCount, verifierCount] = await Promise.all([
      fetchLiveConsignmentBrowseStats("fixedPrice"),
      fetchActiveAuctionCount(),
      fetchActiveVerifierCount(),
    ]);
    listings = browseStats.total;
    verified = browseStats.verified;
    auctions = auctionCount;
    activeVerifiers = verifierCount;
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

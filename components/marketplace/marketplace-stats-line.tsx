import { fetchActiveVerifierCount } from "@/app/actions/verifier-directory";
import { fetchMarketplaceStats } from "@/app/actions/marketplace-listings";
import type { MarketplaceStatsResponse } from "@/lib/types/ponder";

export async function MarketplaceStatsLine() {
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
    return null;
  }

  if (activeListings <= 0 && verifiedCount <= 0 && activeVerifiers <= 0) {
    return null;
  }

  return (
    <div className="mx-auto w-full max-w-7xl xl:max-w-[80rem] px-6 md:px-8 pt-4 pb-0">
      <p className="font-mono text-xs text-text-tertiary tabular-nums">
        {activeListings > 0 ? `${activeListings} listings` : null}
        {activeListings > 0 && verifiedCount > 0 ? " · " : null}
        {verifiedCount > 0 ? `${verifiedCount} verified` : null}
        {(activeListings > 0 || verifiedCount > 0) && activeVerifiers > 0 ? " · " : null}
        {activeVerifiers > 0 ? `${activeVerifiers} active verifiers` : null}
      </p>
    </div>
  );
}

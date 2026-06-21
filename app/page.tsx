import { fetchListingFacets } from "@/app/actions/marketplace-listings";
import { getVerifierDirectory } from "@/app/actions/verifier-directory";
import { MarketBrowse } from "@/components/marketplace/market-browse";
import type { FacetsResponse } from "@/lib/types/ponder";
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
    const [facetsRaw, directory] = await Promise.all([
      fetchListingFacets(),
      getVerifierDirectory(),
    ]);
    const facets = facetsRaw as FacetsResponse | null;
    activeListings = facets?.totalActive ?? 0;
    activeVerifiers = directory.verifiers.length;
    verifiedCount = facets?.statusCounts?.VERIFIED ?? 0;
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

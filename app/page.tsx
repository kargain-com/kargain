import Link from "next/link";

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
  let activeVerifiers = 0;
  let verifiedPassports: number | undefined;

  try {
    const [facetsRaw, directory] = await Promise.all([
      fetchListingFacets(),
      getVerifierDirectory(),
    ]);
    const facets = facetsRaw as FacetsResponse | null;
    activeListings = facets?.totalActive ?? 0;
    activeVerifiers = directory.verifiers.length;
    if (facets?.statusCounts?.VERIFIED != null) {
      verifiedPassports = facets.statusCounts.VERIFIED;
    }
  } catch {
    // stats default to 0 / undefined — page still renders
  }

  return (
    <>
      <section className="w-full hero-pattern">
        <div className="mx-auto w-full max-w-7xl xl:max-w-[80rem] px-6 md:px-8 pt-16 pb-12 md:pt-24 md:pb-16">
          <p className="font-mono text-xs font-medium tracking-[0.18em] uppercase text-accent-warm mb-4">
            Decentralized vehicle marketplace
          </p>

          <h1 className="font-display text-fluid-display font-medium tracking-[-0.02em] leading-[1.1] text-text-primary max-w-2xl">
            Buy and sell vehicles with on-chain trust
          </h1>

          <p className="font-sans text-fluid-body-lg font-normal leading-[1.55] text-text-secondary mt-4 max-w-xl">
            Every vehicle has a verified passport on blockchain.
            Browse certified listings or get your car verified by a KarPro professional.
          </p>

          <div className="flex flex-wrap items-center gap-3 mt-8">
            <a
              href="#listings"
              className="inline-flex items-center justify-center gap-2 min-h-11 px-7 py-3.5
                         rounded-sm bg-white text-bg-primary font-sans text-sm font-medium
                         transition-colors duration-200 hover:bg-text-secondary
                         focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]"
            >
              Browse listings
            </a>
            <Link
              href="/verifiers"
              className="inline-flex items-center justify-center gap-2 min-h-11 px-7 py-3.5
                         rounded-sm border border-border-hover bg-transparent
                         text-text-primary font-sans text-sm font-medium
                         transition-colors duration-200 hover:border-accent-warm hover:text-accent-warm
                         focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]"
            >
              Find a verifier
            </Link>
          </div>

          {(activeListings > 0 || activeVerifiers > 0) && (
            <div className="flex flex-wrap gap-x-8 gap-y-4 mt-10 pt-10 border-t border-border-default">
              {activeListings > 0 && (
                <div className="flex flex-col gap-1">
                  <p className="font-mono text-2xl font-normal tabular-nums text-text-primary">
                    {activeListings}
                  </p>
                  <p className="font-sans text-xs font-normal text-text-secondary">
                    active listings
                  </p>
                </div>
              )}
              {activeVerifiers > 0 && (
                <div className="flex flex-col gap-1">
                  <p className="font-mono text-2xl font-normal tabular-nums text-text-primary">
                    {activeVerifiers}
                  </p>
                  <p className="font-sans text-xs font-normal text-text-secondary">
                    active verifiers
                  </p>
                </div>
              )}
              {verifiedPassports != null && verifiedPassports > 0 && (
                <div className="flex flex-col gap-1">
                  <p className="font-mono text-2xl font-normal tabular-nums text-text-primary">
                    {verifiedPassports}
                  </p>
                  <p className="font-sans text-xs font-normal text-text-secondary">
                    verified passports
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      </section>

      <div id="listings">
        <MarketBrowse initialChainId={initialChainId} />
      </div>
    </>
  );
}

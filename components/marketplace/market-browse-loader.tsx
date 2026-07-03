import {
  searchMarketplaceListings,
  type MarketplaceListingsResult,
} from "@/app/actions/marketplace-listings";
import { MarketBrowse } from "@/components/marketplace/market-browse";
import { filtersFromSearchParams, marketFiltersToApiInput } from "@/lib/marketplace/filter-params";
import {
  marketplaceListingsNeedClientRates,
  searchParamsToUrlSearchParams,
} from "@/lib/marketplace/listings-prefetch";

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function MarketBrowseLoader({ searchParams }: Props) {
  const sp = await searchParams;
  const filters = filtersFromSearchParams(searchParamsToUrlSearchParams(sp));

  let initialListingsPage: MarketplaceListingsResult | undefined;
  if (!marketplaceListingsNeedClientRates(filters)) {
    initialListingsPage = await searchMarketplaceListings(marketFiltersToApiInput(filters));
  }

  return <MarketBrowse initialListingsPage={initialListingsPage} />;
}

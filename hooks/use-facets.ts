"use client";

import { useQuery } from "@tanstack/react-query";

import { fetchListingFacets } from "@/app/actions/marketplace-listings";
import type { FacetsResponse } from "@/lib/types/ponder";

const LISTING_FACETS_QUERY_KEY = ["listing-facets"] as const;
const LISTING_FACETS_STALE_MS = 60_000;

type UseFacetsOptions = {
  enabled?: boolean;
};

export function useFacets(options?: UseFacetsOptions) {
  const enabled = options?.enabled ?? true;

  const { data } = useQuery({
    queryKey: LISTING_FACETS_QUERY_KEY,
    queryFn: async () => {
      const data = await fetchListingFacets();
      if (!data || typeof data !== "object") return null;
      return data as FacetsResponse;
    },
    enabled,
    staleTime: LISTING_FACETS_STALE_MS,
  });

  return {
    facets: data ?? null,
  };
}

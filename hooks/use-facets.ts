"use client";

import { useEffect, useState } from "react";

import { fetchListingFacets } from "@/app/actions/marketplace-listings";
import type { FacetsResponse } from "@/lib/types/ponder";

export function useFacets() {
  const [facets, setFacets] = useState<FacetsResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void fetchListingFacets().then((data) => {
      if (cancelled) return;
      if (data && typeof data === "object") {
        setFacets(data as FacetsResponse);
      }
      setIsLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return { facets, isLoading };
}

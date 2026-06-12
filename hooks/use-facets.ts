"use client";

import type { FacetsResponse } from "@/lib/types/ponder";

export function useFacets() {
  // TODO Phase 1.1: Facets pending new Ponder indexer
  return { facets: null as FacetsResponse | null, isLoading: false };
}

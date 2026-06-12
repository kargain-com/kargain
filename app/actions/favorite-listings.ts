"use server";

import type { MarketplaceListingRow } from "@/app/actions/marketplace-listings";

export async function loadFavoriteListingCards(_tokenIds: string[]): Promise<{
  listings: MarketplaceListingRow[];
  ponderError?: string;
}> {
  // TODO Phase 1.1: Ponder indexer pending new contracts
  return { listings: [] };
}

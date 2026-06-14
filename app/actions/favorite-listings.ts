"use server";

import {
  loadFavoriteListingCards as loadCards,
  type MarketplaceListingRow,
} from "@/app/actions/marketplace-listings";

export async function loadFavoriteListingCards(tokenIds: string[]): Promise<{
  listings: MarketplaceListingRow[];
  ponderError?: string;
}> {
  try {
    const listings = await loadCards(tokenIds);
    return { listings };
  } catch {
    return { listings: [], ponderError: "PONDER_UNAVAILABLE" };
  }
}

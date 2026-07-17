import { normalizeListingFiatCurrency } from "@/lib/marketplace/price-normalize";
import type { OnChainListingRow } from "@/lib/marketplace/parse-on-chain-listing";

export type ChainListingRead = "pending" | "success" | "failure";

export type ActiveEffectiveListing = {
  active: true;
  fiatPrice1e8: string;
  fiatCurrency: number;
  seller: `0x${string}`;
};

type PonderListing = {
  active: boolean;
  fiatPrice1e8: string;
  fiatCurrency: number;
  seller: `0x${string}`;
};

function activeChainListing(
  row: OnChainListingRow | null,
): ActiveEffectiveListing | null {
  if (!row?.active) return null;
  return {
    active: true,
    fiatPrice1e8: String(row.fiatPrice1e8),
    fiatCurrency: normalizeListingFiatCurrency(row.fiatCurrency),
    seller: row.seller,
  };
}

function activePonderListing(
  listing: PonderListing | null,
): ActiveEffectiveListing | null {
  if (!listing?.active) return null;
  return {
    active: true,
    fiatPrice1e8: listing.fiatPrice1e8,
    fiatCurrency: normalizeListingFiatCurrency(listing.fiatCurrency),
    seller: listing.seller,
  };
}

/**
 * A successful chain read is authoritative, including an inactive row.
 * Ponder is only a fallback while the chain read is pending or failed.
 */
export function resolveEffectiveListing(
  chainRead: ChainListingRead,
  chainRow: OnChainListingRow | null,
  ponderListing: PonderListing | null,
): ActiveEffectiveListing | null {
  if (chainRead === "success") return activeChainListing(chainRow);
  return activePonderListing(ponderListing);
}

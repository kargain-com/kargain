import { zeroAddress } from "viem";

import {
  DENOMINATION_KIND,
  type DenominationKind,
  parseDenominationKind,
} from "@/lib/commerce/denomination";
import { normalizeListingFiatCurrency } from "@/lib/marketplace/price-normalize";
import type { OnChainListingRow } from "@/lib/marketplace/parse-on-chain-listing";

export type ChainListingRead = "pending" | "success" | "failure";

/** Active listing facts for detail/buy — denomination-aware. */
export type ActiveEffectiveListing = {
  active: true;
  seller: `0x${string}`;
  price: string;
  denominationKind: DenominationKind;
  asset: `0x${string}`;
  currencyCode: string;
  fiatCurrency: number;
};

type PonderListing = {
  active: boolean;
  seller: `0x${string}`;
  price?: string;
  fiatPrice1e8?: string;
  denominationKind?: number;
  asset?: string;
  currencyCode?: string;
  fiatCurrency: number;
};

function activeChainListing(
  row: OnChainListingRow | null,
): ActiveEffectiveListing | null {
  if (!row?.active) return null;
  return {
    active: true,
    seller: row.seller,
    price: String(row.price),
    denominationKind: row.denominationKind,
    asset: row.asset,
    currencyCode: row.currencyCode,
    fiatCurrency: normalizeListingFiatCurrency(row.fiatCurrency),
  };
}

function activePonderListing(
  listing: PonderListing | null,
): ActiveEffectiveListing | null {
  if (!listing?.active) return null;
  const denominationKind =
    parseDenominationKind(listing.denominationKind) ??
    (listing.fiatPrice1e8 != null &&
    listing.fiatPrice1e8 !== "0" &&
    listing.price == null
      ? DENOMINATION_KIND.Fiat
      : DENOMINATION_KIND.Asset);
  const price =
    listing.price ??
    (denominationKind === DENOMINATION_KIND.Fiat
      ? (listing.fiatPrice1e8 ?? "0")
      : (listing.fiatPrice1e8 ?? "0"));
  let asset: `0x${string}` = zeroAddress;
  if (listing.asset) {
    asset = listing.asset as `0x${string}`;
  }
  return {
    active: true,
    seller: listing.seller,
    price: String(price),
    denominationKind,
    asset,
    currencyCode: listing.currencyCode ?? "",
    fiatCurrency: normalizeListingFiatCurrency(listing.fiatCurrency),
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

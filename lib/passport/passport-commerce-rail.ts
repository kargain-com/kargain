/**
 * Sole owner of passport commerce rail mutex inputs (S8-D1b).
 * Panels consume booleans — never compare CommerceFact to literals in components.
 */

import type { CommerceFact } from "@/lib/passport/commerce-fact";
import { marketplaceListingBlocksAuction } from "@/lib/auction/map-ponder-auction";

export type PassportCommerceRailInput = {
  /** Fixed-price mode configured on this namespace (registry). */
  fixedPriceConfigured: boolean;
  /** Ascending mode configured on this namespace (registry). */
  ascendingConfigured: boolean;
  fixedPriceLive: CommerceFact<boolean>;
  ascendingLive: CommerceFact<boolean>;
  /** Ponder listing active when known. */
  ponderListingActive: boolean;
  /**
   * Auction island already owns the commerce slot (ui-state / hold / ponder).
   * Injected so this owner stays free of auction-detail coupling.
   */
  auctionOwnsCommerce: boolean;
  auctionPonderActive: boolean;
  auctionHoldOpen: boolean;
};

export type PassportCommerceRail = {
  listingBlocksAuction: boolean;
  ascendingLive: boolean;
  enableAuctionDetail: boolean;
  /**
   * Fixed-price live as a boolean for listing island — true only when known true.
   * Pending/refused never present as "not listed".
   */
  fixedPriceLiveKnownTrue: boolean;
};

/**
 * Derive rail mutex from commerce facts.
 *
 * EVM parity:
 * - known true → listed / ascending live
 * - pending → chainListedPending (fail closed as blocking)
 * - refused → same fail-closed as pending (never "not listed")
 * - known false → not listed
 */
export function derivePassportCommerceRail(
  input: PassportCommerceRailInput,
): PassportCommerceRail {
  const fp = input.fixedPriceLive;
  const asc = input.ascendingLive;

  const chainIsListed = fp.status === "known" ? fp.value : undefined;
  const chainListedPending =
    input.fixedPriceConfigured &&
    (fp.status === "pending" || fp.status === "refused");

  const ponderActive =
    input.ponderListingActive ||
    (fp.status === "known" && fp.value);

  const listingBlocksAuction = marketplaceListingBlocksAuction({
    ponderActive,
    chainIsListed,
    chainListedPending,
  });

  const ascendingLive =
    (asc.status === "known" && asc.value) ||
    input.auctionOwnsCommerce ||
    input.auctionPonderActive ||
    input.auctionHoldOpen;

  return {
    listingBlocksAuction,
    ascendingLive,
    enableAuctionDetail: input.ascendingConfigured,
    fixedPriceLiveKnownTrue: fp.status === "known" && fp.value,
  };
}

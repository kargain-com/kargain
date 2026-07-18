import type { PonderAuctionAuthorizationRaw } from "@/app/actions/auction-agent";
import type {
  AuctionConsignmentAuctionFacts,
  AuctionConsignmentInput,
  FixedPriceConsignmentInput,
} from "@/lib/consignment/lifecycle";
import type { PonderAgentAuthorization } from "@/lib/types/ponder";

export type MarketplaceListingFacts = {
  active: boolean;
  agent: string | null | undefined;
  returnRequestedAt?: bigint | string | number | null;
};

/** @deprecated Use `MarketplaceListingFacts`. */
export type OwnerMarketplaceListingFacts = MarketplaceListingFacts;

/**
 * Map a marketplace authorization row (+ optional listing facts) into
 * `deriveFixedPriceConsignment` input. Always resolves auth/listing booleans
 * (never `undefined`) so the lifecycle sees known Ponder truth.
 */
export function marketplaceAuthToLifecycleInput(
  row: PonderAgentAuthorization,
  listing: MarketplaceListingFacts | null,
  nowSec: number,
): FixedPriceConsignmentInput {
  const listingActive = listing?.active === true;
  return {
    tokenId: row.tokenId,
    nowSec,
    authActive: row.active,
    authExpiry: BigInt(row.expiry || 0),
    listingActive,
    listingAgent: listingActive ? listing?.agent ?? null : null,
    returnRequestedAt: listing?.returnRequestedAt ?? 0n,
  };
}

/**
 * Map an auction authorization row (+ optional auction facts) into
 * `deriveAuctionConsignment` input.
 * Pass `auction: null` when there is no auction row; never pass `undefined`
 * from this mapper (unresolved is a caller concern).
 */
export function auctionAuthToLifecycleInput(
  row: PonderAuctionAuthorizationRaw,
  auction: AuctionConsignmentAuctionFacts | null,
  nowSec: number,
): AuctionConsignmentInput {
  return {
    tokenId: row.tokenId,
    nowSec,
    authActive: row.active,
    authExpiry: BigInt(row.expiry || 0),
    authAgent: row.agent,
    auction,
  };
}

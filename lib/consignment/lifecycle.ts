import {
  hasAuctionAgent,
  isAuctionAuthExpired,
} from "@/lib/auction/auction-agent";
import {
  deriveAuctionUiState,
  type AuctionUiState,
} from "@/lib/auction/map-ponder-auction";
import {
  hasListingAgent,
  parseReturnRequestedAt,
} from "@/lib/marketplace/listing-agent";

export type ConsignmentTrack = "fixed_price" | "auction";

export type ConsignmentStateId =
  | "M1"
  | "M1e"
  | "M2"
  | "M2r"
  | "A1"
  | "A1e"
  | "A2"
  | "A2r"
  | "A3"
  | "none";

export type ConsignmentPortfolioItem = {
  track: ConsignmentTrack;
  stateId: ConsignmentStateId;
  /** Needs-attention bucket: expired auth or return-requested. */
  attention: boolean;
  primaryHref: string;
  statusLabel: string;
};

const STATUS_LABEL: Record<Exclude<ConsignmentStateId, "none">, string> = {
  M1: "Awaiting listing",
  M1e: "Authorization expired",
  M2: "Listed",
  M2r: "Return requested",
  A1: "Authorized",
  A1e: "Authorization expired",
  A2: "Awaiting first bid",
  A2r: "Return requested",
  A3: "Live auction",
};

function item(
  track: ConsignmentTrack,
  stateId: Exclude<ConsignmentStateId, "none">,
  tokenId: string,
  attention: boolean,
): ConsignmentPortfolioItem {
  return {
    track,
    stateId,
    attention,
    primaryHref: `/marketplace/${tokenId}`,
    statusLabel: STATUS_LABEL[stateId],
  };
}

function none(
  track: ConsignmentTrack,
  tokenId: string,
): ConsignmentPortfolioItem {
  return {
    track,
    stateId: "none",
    attention: false,
    primaryHref: `/marketplace/${tokenId}`,
    statusLabel: "",
  };
}

export type FixedPriceConsignmentInput = {
  tokenId: string;
  nowSec: number;
  /** `undefined` = unresolved → fail-closed `none`. */
  authActive: boolean | undefined;
  authExpiry: bigint | undefined;
  listingActive: boolean | undefined;
  listingAgent: string | null | undefined;
  returnRequestedAt: bigint | string | number | null | undefined;
};

/**
 * Pure fixed-price consignment portfolio state.
 * Listing with agent wins over authorization-only rows.
 */
export function deriveFixedPriceConsignment(
  input: FixedPriceConsignmentInput,
): ConsignmentPortfolioItem {
  const { tokenId, nowSec } = input;

  if (input.authActive === undefined || input.listingActive === undefined) {
    return none("fixed_price", tokenId);
  }

  if (input.listingActive && hasListingAgent(input.listingAgent)) {
    const returnAt = parseReturnRequestedAt(input.returnRequestedAt);
    if (returnAt > 0n) {
      return item("fixed_price", "M2r", tokenId, true);
    }
    return item("fixed_price", "M2", tokenId, false);
  }

  if (input.authActive) {
    const expiry = input.authExpiry ?? 0n;
    if (isAuctionAuthExpired(expiry, nowSec)) {
      return item("fixed_price", "M1e", tokenId, true);
    }
    return item("fixed_price", "M1", tokenId, false);
  }

  return none("fixed_price", tokenId);
}

export type AuctionConsignmentAuctionFacts = {
  active: boolean;
  phase: string;
  startedAt: bigint;
  endsAtChain: bigint;
  returnRequestedAt: bigint;
  passportStatus: string;
};

export type AuctionConsignmentInput = {
  tokenId: string;
  nowSec: number;
  authActive: boolean | undefined;
  authExpiry: bigint | undefined;
  authAgent: string | null | undefined;
  /**
   * No live/ponder auction row → `null`.
   * Unresolved auction truth → `undefined` (fail-closed).
   */
  auction: AuctionConsignmentAuctionFacts | null | undefined;
};

function auctionFromUiState(
  tokenId: string,
  uiState: AuctionUiState,
  returnRequestedAt: bigint,
): ConsignmentPortfolioItem | null {
  if (uiState === "S1") {
    if (returnRequestedAt > 0n) {
      return item("auction", "A2r", tokenId, true);
    }
    return item("auction", "A2", tokenId, false);
  }
  if (uiState === "S3" || uiState === "S4") {
    return item("auction", "A3", tokenId, false);
  }
  return null;
}

function deriveAuctionAuthOnly(
  input: AuctionConsignmentInput,
): ConsignmentPortfolioItem {
  const { tokenId, nowSec } = input;

  if (input.authActive === undefined) {
    return none("auction", tokenId);
  }

  if (
    input.authActive &&
    hasAuctionAgent(input.authAgent)
  ) {
    const expiry = input.authExpiry ?? 0n;
    if (isAuctionAuthExpired(expiry, nowSec)) {
      return item("auction", "A1e", tokenId, true);
    }
    return item("auction", "A1", tokenId, false);
  }

  return none("auction", tokenId);
}

/**
 * Pure auction consignment portfolio state.
 * Live auction UI states (S1/S3/S4) take precedence; terminals fall through to auth.
 */
export function deriveAuctionConsignment(
  input: AuctionConsignmentInput,
): ConsignmentPortfolioItem {
  const { tokenId } = input;

  if (input.auction === undefined) {
    return none("auction", tokenId);
  }

  if (input.auction != null) {
    const uiState = deriveAuctionUiState({
      phase: input.auction.phase,
      active: input.auction.active,
      endsAtChain: input.auction.endsAtChain,
      startedAt: input.auction.startedAt,
      passportStatus: input.auction.passportStatus,
      now: input.nowSec,
    });
    const fromAuction = auctionFromUiState(
      tokenId,
      uiState,
      input.auction.returnRequestedAt,
    );
    if (fromAuction) return fromAuction;
  }

  return deriveAuctionAuthOnly(input);
}

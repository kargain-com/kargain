import {
  hasAuctionAgent,
  isAuctionAuthExpired,
  type AuctionAgentAuth,
} from "@/lib/auction/auction-agent";
import type { PassportStatus } from "@/lib/types/ponder";

export type SellListingState =
  | "pending"
  | "failure"
  | "active"
  | "inactive";

export type SellSurfaceFlags = {
  showList: boolean;
  showDelegate: boolean;
  showMarketplaceAuthCard: boolean;
  showAuctionCreate: boolean;
  showAuctionAuthorize: boolean;
  showAuctionAuthCard: boolean;
  showAuctionRequirementNote: boolean;
};

type AuctionAuthState = {
  /** `null` means a successful read with no active authorization. */
  value: AuctionAgentAuth | null;
  now: number;
};

export type SellSurfaceInput = {
  isOwner: boolean;
  listingState: SellListingState;
  /** `undefined` means auction truth is unresolved or unavailable. */
  auctionBlocks: boolean | undefined;
  auctionEscrowConfigured: boolean;
  passportStatus: PassportStatus;
  /** `undefined` means the staking read is unresolved or unavailable. */
  isActiveVerifier: boolean | undefined;
  /** `undefined` means the marketplace authorization read is unresolved. */
  marketplaceAuthActive: boolean | undefined;
  /** `undefined` means the auction authorization read is unresolved. */
  auctionAuth: AuctionAuthState | undefined;
};

const HIDDEN_FLAGS: SellSurfaceFlags = {
  showList: false,
  showDelegate: false,
  showMarketplaceAuthCard: false,
  showAuctionCreate: false,
  showAuctionAuthorize: false,
  showAuctionAuthCard: false,
  showAuctionRequirementNote: false,
};

/**
 * Pure owner sell-surface policy. Unknown chain facts fail closed per row.
 * Expired-but-active auction authorizations remain owner management surfaces.
 */
export function deriveSellSurface(
  input: SellSurfaceInput,
): SellSurfaceFlags {
  if (
    !input.isOwner ||
    input.listingState !== "inactive" ||
    input.auctionBlocks !== false
  ) {
    return { ...HIDDEN_FLAGS };
  }

  const marketplaceAuthKnown =
    typeof input.marketplaceAuthActive === "boolean";
  const verified = input.passportStatus === "VERIFIED";
  const auctionAuthState = input.auctionAuth;
  const auctionAuth = auctionAuthState?.value;
  const auctionAuthStatus =
    auctionAuthState &&
    auctionAuth?.active &&
    hasAuctionAgent(auctionAuth.agent)
      ? isAuctionAuthExpired(auctionAuth.expiry, auctionAuthState.now)
        ? "expired"
        : "active"
      : "inactive";
  const showAuctionAuthCard =
    verified &&
    input.auctionAuth !== undefined &&
    auctionAuthStatus !== "inactive";
  const mayChooseAuctionPath =
    verified &&
    input.auctionAuth !== undefined &&
    auctionAuthStatus === "inactive";

  return {
    showList: true,
    showDelegate: marketplaceAuthKnown && input.marketplaceAuthActive === false,
    showMarketplaceAuthCard:
      marketplaceAuthKnown && input.marketplaceAuthActive === true,
    showAuctionCreate:
      mayChooseAuctionPath && input.isActiveVerifier === true,
    showAuctionAuthorize:
      mayChooseAuctionPath && input.isActiveVerifier === false,
    showAuctionAuthCard,
    showAuctionRequirementNote:
      input.auctionEscrowConfigured && !verified,
  };
}

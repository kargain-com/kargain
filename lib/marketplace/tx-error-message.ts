import { UserRejectedRequestError } from "viem";

const REVERT_COPY: ReadonlyArray<readonly [string, string]> = [
  ["AlreadyListed", "This vehicle is already listed. Delist it first."],
  ["MarketplaceNotApproved", "Approve the marketplace on your passport first."],
  ["CannotRaiseMinPrice", "New minimum must be lower than the current minimum."],
  ["AgentAuthorizationActive", "Return the vehicle from the agent before revoking access."],
  [
    "BelowOwnerMinPrice",
    "Owner would receive less than their guaranteed minimum after fees. Lower commission or raise the asking price.",
  ],
  [
    "AgentNotAuthorized",
    "You are not authorized for this vehicle, or the authorization expired.",
  ],
  ["AgentFeeTooHigh", "Commission cannot exceed 30%."],
  [
    "ReturnAlreadyRequested",
    "A return has already been requested. Check the countdown for when force return becomes available.",
  ],
  ["ReturnCooldownPending", "The 7-day return countdown has not finished yet."],
  ["ReturnNotRequested", "Request a return first before forcing it."],
  ["EmptySettlementNote", "Settlement note cannot be empty."],
  [
    "NotVerifier",
    "You must be an active KarPro verifier to set a verification fee.",
  ],
  [
    "InsufficientDeposit",
    "The required deposit has changed. Please retry.",
  ],
  [
    "NotDisputeOpener",
    "Only the dispute opener can withdraw this dispute.",
  ],
  ["NoActiveDispute", "This passport is not in an active dispute."],
  [
    "CannotResolveSelfDispute",
    "You cannot resolve a dispute you opened yourself.",
  ],
  // AuctionEscrow — blueprint §4.3 (verbatim; bracketed tokens substituted at call site)
  [
    "BidTooLow",
    "Bid at least [min next bid] — the minimum step is [3]% above the current bid.",
  ],
  ["AuctionEnded", "This auction has ended. The page will update shortly."],
  [
    "AuctionAlreadyStarted",
    "The first bid has been placed — this auction can no longer be cancelled or recalled.",
  ],
  ["BidFromSeller", "Sellers and agents cannot bid on their own auction."],
  ["BidFromAgent", "Sellers and agents cannot bid on their own auction."],
  [
    "PassportNotVerified",
    "Bidding requires a verified passport. This vehicle is currently [unverified / disputed].",
  ],
  [
    "PassportDisputed",
    "Bidding requires a verified passport. This vehicle is currently [unverified / disputed].",
  ],
  [
    "SettlementPending",
    "The previous sale of this vehicle is still settling. Try again after the hold ends.",
  ],
  [
    "WrongValue",
    "Amount does not match the auction currency. Refresh and try again.",
  ],
  [
    "WrongAsset",
    "Amount does not match the auction currency. Refresh and try again.",
  ],
  [
    "BelowOwnerMinAsset",
    "At this reserve the owner would receive less than their guaranteed minimum. Raise the reserve or lower the commission.",
  ],
  [
    "BondTooLow",
    "The dispute bond is [0.01 ETH]. Send the exact amount shown.",
  ],
  ["HoldReleased", "The payment hold has already been released."],
  [
    "ContractPaused",
    "Auctions are temporarily paused. Existing refunds and payouts are unaffected.",
  ],
];

/** Format BidTooLow with mono min-bid + increment % (blueprint §4.3). */
export function formatBidTooLowMessage(
  minNextBidLabel: string,
  minIncrementBps: number,
): string {
  const pct = Math.round(minIncrementBps / 100);
  return `Bid at least ${minNextBidLabel} — the minimum step is ${pct}% above the current bid.`;
}

/** Substitute passport status into PassportNotVerified / PassportDisputed copy. */
export function formatPassportBidBlockedMessage(
  status: "unverified" | "disputed",
): string {
  return `Bidding requires a verified passport. This vehicle is currently ${status}.`;
}

function mapRevertReason(message: string): string | null {
  for (const [reason, copy] of REVERT_COPY) {
    if (message.includes(reason)) return copy;
  }
  return null;
}

export function txErrorMessage(err: unknown): string {
  if (
    err instanceof UserRejectedRequestError ||
    (err instanceof Error &&
      (err.message.includes("User rejected") || err.message.includes("User denied")))
  ) {
    return "Wallet signature cancelled.";
  }
  if (err instanceof Error && err.message.trim()) {
    const mapped = mapRevertReason(err.message);
    if (mapped) return mapped;
    return err.message.length > 160 ? `${err.message.slice(0, 160)}…` : err.message;
  }
  return "Transaction failed.";
}

import { UserRejectedRequestError } from "viem";

/**
 * Exact error-name → user copy. Every production custom error must appear here with a
 * distinct message. Resolution uses whole-identifier match + longest-name wins (no list order).
 */
export const REVERT_COPY: Readonly<Record<string, string>> = {
  AlreadyListed: "This vehicle is already listed. Delist it first.",
  NotActive: "This listing is not active.",
  NotOwner: "Only the passport owner can do this.",
  NotSellerOrAgent: "Only the seller or listing agent can confirm this payment.",
  NotSeller: "Only the seller of this sale can do this.",
  NotAgent: "Only the authorized agent can do this.",
  NoAgent: "This sale has no agent. Use the direct seller action instead.",
  ListingHasAgent:
    "This sale has an agent. Use the agent cancel or delist path instead.",
  AuctionHasAgent:
    "This auction has an agent. Use the agent cancel path instead.",
  CannotRaiseMinPrice: "New minimum must be lower than the current minimum.",
  BelowOwnerMinPrice:
    "Owner would receive less than their guaranteed minimum after fees. Lower commission or raise the asking price.",
  AgentNotAuthorized:
    "You are not authorized for this vehicle, or the authorization expired.",
  AgentFeeTooHigh: "Commission cannot exceed 30%.",
  ReturnAlreadyRequested:
    "A return has already been requested. Check the countdown for when force return becomes available.",
  ReturnCooldownPending: "The 7-day return countdown has not finished yet.",
  ReturnNotRequested: "Request a return first before forcing it.",
  EmptySettlementNote: "Settlement note cannot be empty.",
  NotVerifier: "You must be an active KarPro verifier to set a verification fee.",
  InsufficientDeposit: "The required deposit has changed. Please retry.",
  NotDisputeOpener: "Only the dispute opener can withdraw this dispute.",
  NoActiveDispute: "This passport is not in an active dispute.",
  CannotResolveSelfDispute: "You cannot resolve a dispute you opened yourself.",
  BidTooLow:
    "Bid at least [min next bid] — the minimum step is [3]% above the current bid.",
  AuctionEnded: "This auction has ended. The page will update shortly.",
  AuctionAlreadyStarted:
    "The first bid has been placed — this auction can no longer be cancelled or recalled.",
  BidFromSeller: "Sellers cannot bid on their own auction.",
  BidFromAgent: "Agents cannot bid on their own auction.",
  PassportNotVerified:
    "Bidding requires a verified passport. This vehicle is currently unverified.",
  PassportDisputed:
    "Bidding requires a verified passport. This vehicle is currently disputed.",
  SettlementPending:
    "The previous sale of this vehicle is still settling. Try again after the hold ends.",
  WrongValue: "Native amount does not match. Refresh and try again.",
  WrongAsset: "Payment asset does not match this auction. Refresh and try again.",
  BelowOwnerMinAsset:
    "At this reserve the owner would receive less than their guaranteed minimum. Raise the reserve or lower the commission.",
  BondTooLow: "The dispute bond is [0.01 ETH]. Send the exact amount shown.",
  HoldReleased: "The payment hold has already been released.",
  ContractPaused:
    "This contract is temporarily paused. Existing refunds and payouts are unaffected.",
  NoHold: "There is no open settlement hold for this vehicle.",
  DisputeActive:
    "A settlement dispute is still open. Wait for resolution or the auto-release timeout.",
  HoldActive: "The settlement or abandoned-refund window has not finished yet.",
  RefundNotPending: "No failed-sale refund is pending for this vehicle.",
  RefundPending: "A failed-sale refund is pending for this vehicle.",
  NotBuyer: "Only the winning buyer can do this.",
  ListedInMarketplace: "Delist this vehicle before bridging.",
  NoClaim: "There is no pending claim to withdraw for this asset.",
  TransferFailed: "The transfer could not be completed. Try again later.",
  TokenHasNoCode: "That address has no contract code and cannot be used as a token.",
  TokenNonConforming:
    "That token does not follow the ERC-20 transfer return convention and cannot be used.",
  TokenDecimalsUnavailable:
    "That token does not expose a decimals() value and cannot be used as a payment token.",
  ZeroFeedStaleness: "Oracle freshness window must be greater than zero.",
  InvalidCategory: "That verifier category is not valid.",
  AlreadyVerifier: "This wallet is already an active verifier.",
  BelowMinStake: "Stake amount is below the current minimum.",
  BelowMinStakeFloor: "Minimum stake cannot go below the protocol floor.",
  TokenNotEnabled: "This stake token is not enabled.",
  NonexistentToken: "This passport does not exist.",
  NotActiveVerifier: "Only an active KarPro verifier can do this.",
  CannotSelfVerify: "You cannot verify your own passport.",
  InvalidStatus: "This action is not allowed in the current passport status.",
  EmptyField: "A required field is empty.",
  SameURI: "The new metadata URI is the same as the current one.",
  NothingToRescue: "There is no excess ETH available to rescue.",
  TokenIdSpaceExhausted: "This chain’s passport id space is exhausted.",
  GatewayAlreadySet: "The bridge gateway is already set.",
  NotBridgeGateway: "Only the bound bridge gateway can do this.",
  NotForeignToken: "This token id is not a foreign representation.",
  NotHomeToken: "This token id is not a home-chain passport.",
  TokenExists: "This passport id already exists.",
  PassportBridgedAway: "This passport is bridged away and cannot be used here.",
  BadPrice: "Listing price is invalid.",
  FeeTooHigh: "Platform fee is above the allowed maximum.",
  StalePrice: "The price oracle answer is stale. Try again shortly.",
  BadOracleAnswer: "The price oracle returned an invalid answer.",
  NotUpgradeAuthority: "Only the upgrade authority can do this.",
  CurrencyNotAvailableOnChain: "This listing currency is not available on this chain.",
  InvalidCurrencyCode: "That currency code cannot be registered as a listing feed.",
  InvalidFeed: "Currency feed address is invalid.",
  InvalidFeedDecimals: "Currency feed decimals are invalid.",
  PaymentTokenNotSupported: "This payment token is not supported.",
  DirectEthNotAccepted: "Send ETH only through the supported payable functions.",
  AuctionExists: "An auction already exists for this vehicle.",
  NoAuction: "There is no active auction for this vehicle.",
  AuctionNotStarted: "The auction has not started yet.",
  AuctionNotEnded: "The auction has not ended yet.",
  UnsupportedAsset: "This settlement asset is not supported.",
  BadDuration: "Auction duration is outside the allowed range.",
  BadReserve: "Auction reserve must be greater than zero.",
  EscrowNotApproved: "Approve the escrow on your passport first.",
  NoDispute: "There is no open settlement dispute for this vehicle.",
  CannotResolveOwnDeal: "You cannot resolve a dispute on your own deal.",
  ZeroAddress: "Address cannot be zero.",
  BadConfig: "Configuration value is outside the allowed range.",
  InSettlementHold: "This passport is in an auction settlement hold.",
  NotRepresentationOwner: "Only the representation owner can do this.",
  NotLocked: "This passport is not custody-locked for bridging.",
  OnlyStaking: "Only KarProStaking can call this.",
  AlreadyHoldsPass: "This wallet already holds a KarPro Pass.",
  DoesNotHoldPass: "This wallet does not hold a KarPro Pass.",
  Soulbound: "KarPro Pass is soulbound and cannot be transferred.",
  NotHolder: "Only the KarPro Pass holder can do this.",
};

const ERROR_NAMES = Object.keys(REVERT_COPY).sort((a, b) => b.length - a.length);

/** Whole-identifier match; longest matching name wins (order-independent). */
export function resolveRevertCopy(message: string): string | null {
  let best: string | null = null;
  for (const name of ERROR_NAMES) {
    const re = new RegExp(`(^|[^A-Za-z0-9_])${name}([^A-Za-z0-9_]|$)`);
    if (!re.test(message)) continue;
    if (best == null || name.length > best.length) best = name;
  }
  return best == null ? null : REVERT_COPY[best]!;
}

/** Format BidTooLow with mono min-bid + increment % (blueprint §4.3). */
export function formatBidTooLowMessage(
  minNextBidLabel: string,
  minIncrementBps: number,
): string {
  const pct = Math.round(minIncrementBps / 100);
  return `Bid at least ${minNextBidLabel} — the minimum step is ${pct}% above the current bid.`;
}

/** Bridge-context override for PassportDisputed (global map is auction-oriented). */
export function formatPassportBridgeBlockedMessage(): string {
  return "Resolve the dispute before bridging.";
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
    const mapped = resolveRevertCopy(err.message);
    if (mapped) return mapped;
    return err.message.length > 160 ? `${err.message.slice(0, 160)}…` : err.message;
  }
  return "Transaction failed.";
}

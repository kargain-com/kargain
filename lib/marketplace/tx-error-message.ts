import { UserRejectedRequestError } from "viem";

/**
 * Exact error-name → user copy. Every production custom error must appear here with a
 * distinct message. Resolution uses whole-identifier match + longest-name wins (no list order).
 */
export const REVERT_COPY: Readonly<Record<string, string>> = {
  NotOwner: "Only the passport owner can do this.",
  NotSellerOrAgent: "Only the seller or listing agent can confirm this payment.",
  NotAgent: "Only the authorized agent can do this.",
  ReturnAlreadyRequested:
    "A return has already been requested. Check the countdown for when force return becomes available.",
  ReturnCooldownPending: "The return countdown has not finished yet.",
  ReturnNotRequested: "Request a return first before forcing it.",
  EmptySettlementNote: "Settlement note cannot be empty.",
  NotVerifier: "You must be an active KarPro verifier to set a verification fee.",
  NotDisputeOpener: "Only the dispute opener can withdraw this dispute.",
  NoActiveDispute: "This passport is not in an active dispute.",
  CannotResolveOwnDispute:
    "You cannot resolve this dispute — you opened it, own the passport, or are the challenged verifier.",
  DisputeWindowActive: "The dispute window has not ended yet.",
  DisputeWindowElapsed:
    "The dispute window has ended. Only concluding the dispute is available now.",
  ZeroDisputeDeposit: "Dispute deposit cannot be zero.",
  UnbondPending: "Finish claiming your unbonding stake before rejoining.",
  UnbondNotReady: "Your stake is still in the unbonding period.",
  NoUnbond: "There is no unbonding stake to claim.",
  BidTooLow:
    "Bid at least [min next bid] — the minimum step is [3]% above the current bid.",
  AuctionEnded: "This auction has ended. The page will update shortly.",
  BidFromSeller: "Sellers cannot bid on their own auction.",
  BidFromAgent: "Agents cannot bid on their own auction.",
  SettlementPending:
    "The previous sale of this vehicle is still settling. Try again after the hold ends.",
  WrongValue: "Native amount does not match. Refresh and try again.",
  ShortDelivery:
    "The payment token delivered less than required. Fee-on-transfer tokens are not supported.",
  ContractPaused:
    "This contract is temporarily paused. Existing refunds and payouts are unaffected.",
  NotGuardian: "Only the commerce guardian can do this.",
  NotGuardianOrOwner: "Only the commerce guardian or the contract owner can do this.",
  ModeNotEncumbranceSource:
    "This selling mode is not registered as an encumbrance source on the passport.",
  NoHold: "There is no open settlement hold for this vehicle.",
  DisputeActive:
    "A settlement challenge is still open. Wait for resolution or the challenge window to end.",
  LeaveChainRefused:
    "This passport cannot leave the chain right now (encumbrance refused).",
  NoClaim: "There is no pending claim to withdraw for this asset.",
  TransferFailed: "The transfer could not be completed. Try again later.",
  TokenHasNoCode: "That address has no contract code and cannot be used as a token.",
  TokenNonConforming:
    "That token does not follow the ERC-20 transfer return convention and cannot be used.",
  TokenDecimalsUnavailable:
    "That token does not expose a decimals() value and cannot be used as a payment token.",
  ZeroFeedStaleness:
    "A measured price feed requires a non-zero freshness tolerance.",
  StalenessWithoutFeed:
    "A freshness tolerance cannot be set without a price feed.",
  FeedStalenessOutOfBounds:
    "Feed freshness tolerance is outside the allowed range (60 seconds to 48 hours).",
  InvalidCategory: "That verifier category is not valid.",
  AlreadyVerifier: "This wallet is already an active verifier.",
  BelowMinStake: "Stake amount is below the current minimum.",
  BelowMinStakeFloor: "Minimum stake cannot go below the protocol floor.",
  ZeroMinStake: "Token stake minimum cannot be zero.",
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
  FeeTooHigh: "Platform fee is above the allowed maximum.",
  StalePrice: "The price oracle answer is stale for this feed's freshness window. Try again shortly.",
  BadOracleAnswer: "The price oracle returned an invalid answer.",
  CurrencyNotAvailableOnChain: "This listing currency is not available on this chain.",
  InvalidCurrencyCode: "That currency code cannot be registered as a listing feed.",
  InvalidFeed: "Currency feed address is invalid.",
  InvalidFeedDecimals: "Currency feed decimals are invalid.",
  PaymentTokenNotSupported: "This payment token is not supported.",
  PaymentTokenFeedRequired:
    "Fiat-priced sales in this token need a payment-token price feed.",
  CannotClearPaymentTokenFeed:
    "A payment-token price feed cannot be cleared once set.",
  DirectEthNotAccepted: "Send ETH only through the supported payable functions.",
  AuctionNotEnded: "The auction has not ended yet.",
  BadDuration: "Auction duration is outside the allowed range.",
  ProtectionOutOfBounds: "Protection window is outside the allowed range.",
  BadReserve: "Auction reserve must be greater than zero.",
  EscrowNotApproved: "Approve the selling mode contract to hold your passport first.",
  ZeroAddress: "Address cannot be zero.",
  BadConfig: "Configuration value is outside the allowed range.",
  NotRepresentationOwner: "Only the representation owner can do this.",
  NotLocked: "This passport is not custody-locked for bridging.",
  OnlyStaking: "Only KarProStaking can call this.",
  AlreadyHoldsPass: "This wallet already holds a KarPro Pass.",
  DoesNotHoldPass: "This wallet does not hold a KarPro Pass.",
  Soulbound: "KarPro Pass is soulbound and cannot be transferred.",
  NotHolder: "Only the KarPro Pass holder can do this.",
  NotEligibleChallenger: "This address is not eligible to open the challenge.",
  NotQualifiedJudge:
    "Only a qualified professional can resolve this challenge. Active KarPro status is required.",
  SourceAlreadyRegistered: "That encumbrance source is already registered.",
  SourceNotRegistered: "That encumbrance source is not registered.",
  TooManyEncumbranceSources: "The encumbrance source registry is full (maximum eight).",
  ZeroForfeitRecipient: "Challenge forfeit recipient cannot be zero.",
  ZeroChallengeWindow: "Challenge window must be greater than zero.",
  ChallengeAlreadyConfigured: "Bonded challenge is already configured.",
  ChallengeNotConfigured: "Bonded challenge is not configured.",
  SourceUnanswerable:
    "An encumbrance source could not answer. Governance must remove or replace that source before this action can proceed.",
  CannotRouteBondToJudge:
    "The routed bond would reach the judge; refresh and try the correct outcome.",
  NotPassportOwner: "Only the passport owner can manage this mandate.",
  LiveConsignment: "Finish or return the live consignment before changing the mandate.",
  NoLiveConsignment: "There is no live consignment to concede against.",
  MandateExpired: "This mandate has expired. Grant a new one to open a consignment.",
  NoMandate: "There is no active mandate for this passport.",
  DenominationMismatch:
    "The consignment denomination must match the mandate. Grant a new mandate for other terms.",
  CannotRaiseFloor: "The owner floor may only be lowered while a consignment is live.",
  CannotRaiseCommission: "The commission rate may only be lowered by the agent.",
  NotCommissionForm: "This consignment uses margin compensation, so there is no commission rate.",
  NotConsignmentAgent: "Only the consignment agent can lower the commission.",
  NotConsignmentSeller: "Only the consignment seller can request or force a recall.",
  NotOfferedAgented:
    "Recall is only available while an agented offer is open — not after a sale is bound.",
  OpenConsignmentRefused:
    "This passport cannot open a consignment right now (encumbrance refused).",
  NotOffered: "This lot is not open for bidding or withdrawal.",
  NotDirectConsignment:
    "Only a direct (unagented) seller can withdraw immediately — use recall when an agent is appointed.",
  BelowFloor:
    "This price or settlement would leave the owner below their protected floor.",
  NotConsignmentRunner: "Only the party running this sale can change the price.",
  AscendingOpenPath:
    "Use the ascending open entrypoints that include auction duration.",
  TermsFixed: "Ascending sale terms are fixed at creation and cannot be amended.",
  NotBinding: "Settlement requires a binding ascending sale with a winning bid.",
  HoldNotReady: "The protection window is still open or frozen by a challenge.",
  NotHoldBuyer: "Only the settlement buyer can confirm receipt or complete a reversal.",
  ReversalPending: "A settlement reversal is pending. Complete or abandon it first.",
  NoReversalPending: "There is no pending settlement reversal for this vehicle.",
  AbandonmentNotReady: "The abandonment window has not finished yet.",
  ProtectionElapsed: "The protection window has ended. Confirm or release instead.",
  NotPassportHolder: "Return the passport to this wallet before completing the reversal.",
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

/** Bridge-context override for LeaveChainRefused when a challenge is open. */
export function formatPassportBridgeBlockedMessage(): string {
  return "Resolve the open challenge before bridging.";
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

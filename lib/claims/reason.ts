/**
 * Derive why a ClaimRecorded credit exists.
 * The on-chain event has no reason field — infer from emitting contract role + tx selector.
 */

import type { ClaimableContractRole } from "@/lib/web3/claimable-contracts";

export const CLAIM_REASON_CODES = [
  "auction.outbid_refund",
  "auction.settlement_payout",
  "auction.buyer_refund",
  "auction.abandoned_refund",
  "auction.bond_payout",
  "marketplace.settlement_payout",
  "passport.dispute_deposit",
  "passport.rescue",
  "staking.stake_refund",
  "unknown",
] as const;

export type ClaimReasonCode = (typeof CLAIM_REASON_CODES)[number];

/** First 4 bytes of known ClaimablePayouts call paths (keccak selectors). */
const SELECTOR_REASON: Record<
  ClaimableContractRole,
  Record<string, ClaimReasonCode>
> = {
  auction: {
    "0x4cafdb15": "auction.outbid_refund", // bid(uint256,uint128)
    "0x843cba13": "auction.settlement_payout", // confirmReceipt
    "0x4d68282f": "auction.settlement_payout", // releaseFunds
    "0x7c0fd474": "auction.buyer_refund", // returnPassportAndRefund
    "0x105f72cd": "auction.abandoned_refund", // claimAbandonedRefund
    "0xe972e3cd": "auction.bond_payout", // resolveSettlementDispute — bond +/or payout
  },
  marketplace: {
    "0x31ad36ab": "marketplace.settlement_payout", // buyWithNative
    "0x8eecec53": "marketplace.settlement_payout", // buyWithToken
    "0x5039c5f7": "marketplace.settlement_payout", // confirmExternalPayment
  },
  passport: {
    "0x2e1a7d4d": "passport.dispute_deposit", // withdraw
    "0xceb983aa": "passport.dispute_deposit", // judge
    "0x3487b256": "passport.dispute_deposit", // conclude
    "0xc877714f": "passport.rescue", // rescueExcessEth
  },
  staking: {
    "0xeb321173": "staking.stake_refund", // claimStake
  },
};

const ROLE_FALLBACK: Record<ClaimableContractRole, ClaimReasonCode> = {
  auction: "auction.settlement_payout",
  marketplace: "marketplace.settlement_payout",
  passport: "passport.dispute_deposit",
  staking: "staking.stake_refund",
};

export function normalizeTxSelector(input: string | undefined | null): string | null {
  if (!input || input.length < 10) return null;
  const hex = input.startsWith("0x") || input.startsWith("0X") ? input.slice(0, 10) : null;
  if (!hex || !/^0x[0-9a-fA-F]{8}$/.test(hex)) return null;
  return hex.toLowerCase();
}

export function inferClaimReason(input: {
  role: ClaimableContractRole | null;
  txInput?: string | null;
}): ClaimReasonCode {
  const { role, txInput } = input;
  if (role == null) return "unknown";
  const selector = normalizeTxSelector(txInput ?? null);
  if (selector) {
    const mapped = SELECTOR_REASON[role][selector];
    if (mapped) return mapped;
  }
  return ROLE_FALLBACK[role];
}

/** Sentence-case explanation for list / advisory surfaces. */
export function claimReasonExplanation(code: ClaimReasonCode): string {
  switch (code) {
    case "auction.outbid_refund":
      return "An auction bid refund could not be delivered to your wallet, so it was recorded as a claim.";
    case "auction.settlement_payout":
      return "An auction sale payout could not be delivered to your wallet, so it was recorded as a claim.";
    case "auction.buyer_refund":
      return "An auction buyer refund could not be delivered to your wallet, so it was recorded as a claim.";
    case "auction.abandoned_refund":
      return "An abandoned auction refund payout could not be delivered to your wallet, so it was recorded as a claim.";
    case "auction.bond_payout":
      return "An auction settlement bond or payout could not be delivered to your wallet, so it was recorded as a claim.";
    case "marketplace.settlement_payout":
      return "A marketplace sale payout could not be delivered to your wallet, so it was recorded as a claim.";
    case "passport.dispute_deposit":
      return "A dispute deposit could not be delivered to your wallet, so it was recorded as a claim.";
    case "passport.rescue":
      return "Rescued excess ETH could not be delivered to your wallet, so it was recorded as a claim.";
    case "staking.stake_refund":
      return "Your KarPro stake refund could not be delivered to your wallet, so it was recorded as a claim.";
    case "unknown":
      return "Funds could not be delivered and are waiting for you to withdraw.";
  }
}

export function claimableRoleLabel(role: ClaimableContractRole | null): string {
  switch (role) {
    case "passport":
      return "KarPassport";
    case "staking":
      return "KarPro staking";
    case "marketplace":
      return "Marketplace escrow";
    case "auction":
      return "Auction escrow";
    case null:
      return "Protocol contract";
  }
}

export function isClaimReasonCode(value: string): value is ClaimReasonCode {
  return (CLAIM_REASON_CODES as readonly string[]).includes(value);
}

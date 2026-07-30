/**
 * Derive why a ClaimRecorded credit exists.
 * The on-chain event has no reason field — infer from emitting contract role + tx selector.
 */

import type { ClaimableContractRole } from "@/lib/web3/claimable-contracts";

export const CLAIM_REASON_CODES = [
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
  passport: {
    "0x2e1a7d4d": "passport.dispute_deposit", // withdraw
    "0xceb983aa": "passport.dispute_deposit", // judge
    "0x3487b256": "passport.dispute_deposit", // conclude
    "0xc877714f": "passport.rescue", // rescueExcessEth
  },
  staking: {
    "0xeb321173": "staking.stake_refund", // claimStake
  },
  /** Mode claims use same-tx event correlation in ponder-commerce — not selectors. */
  fixedPrice: {},
  ascending: {},
};

const ROLE_FALLBACK: Record<ClaimableContractRole, ClaimReasonCode> = {
  passport: "passport.dispute_deposit",
  staking: "staking.stake_refund",
  fixedPrice: "unknown",
  ascending: "unknown",
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
    case "fixedPrice":
      return "Fixed-price consignment";
    case "ascending":
      return "Ascending consignment";
    case null:
      return "Protocol contract";
  }
}

export function isClaimReasonCode(value: string): value is ClaimReasonCode {
  return (CLAIM_REASON_CODES as readonly string[]).includes(value);
}

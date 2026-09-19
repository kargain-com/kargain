/**
 * S8-D0 — sole runtime reader: is this capability supported on this commercial
 * namespace, and which wallet family does it need?
 *
 * Availability derives from capability × namespace (via commercialActive.vm).
 * Session checks compose on top — they never re-derive support.
 * Class is derived from the SVM cell (never stored). Addresses stay in commercial-active.
 */

import {
  commercialActive,
  type CommercialRegistry,
  type CommercialVm,
} from "@/lib/web3/commercial-active";

/**
 * Closed capability ids — one read fact or one write action each.
 * No mechanism buckets, no session-gate identity, no aggregate commerce-facts.
 */
export const SURFACE_CAPABILITIES = [
  // Dual-VM passport / KarPro writes
  "set_passport_uri",
  "append_passport_record",
  "report_passport_discrepancy",
  "append_passport_attestation",
  "verify_passport",
  "open_challenge",
  "withdraw_challenge",
  "judge_challenge",
  "conclude_challenge",
  // Ascending challenge writes
  "ascending_open_challenge",
  "ascending_withdraw_challenge",
  "ascending_judge_challenge",
  "ascending_conclude_challenge",
  "set_verification_fee",
  "create_passport",
  // Passport reads
  "custody_locked",
  "may_open_consignment",
  "may_leave_chain",
  "encumbrance_registry",
  "challenge_bond_amount",
  "verification_fee",
  "active_verifier",
  "passport_owner",
  "passport_status",
  "dispute_window",
  "settlement_notes",
  "hold_protection_ends_at",
  "has_unresolved_settlement",
  // Approvals / bridge / commerce writes
  "passport_approve",
  "passport_approval_state",
  "passport_set_approval_for_all",
  "bridge_send",
  "fixed_price_open_direct",
  "fixed_price_set_price",
  "fixed_price_set_settlement_note",
  "fixed_price_buy",
  "fixed_price_owner_withdraw",
  "fixed_price_confirm_external_payment",
  "fixed_price_grant_mandate",
  "fixed_price_revoke_mandate",
  "fixed_price_lower_floor",
  "fixed_price_lower_commission",
  "fixed_price_request_recall",
  "fixed_price_force_recall",
  "fixed_price_pause",
  "fixed_price_revoke_payment_token",
  "fixed_price_withdraw_claim",
  "ascending_open_direct",
  "ascending_bid",
  "ascending_cancel",
  "ascending_settle",
  "ascending_complete_reversal",
  "ascending_grant_mandate",
  "ascending_revoke_mandate",
  "ascending_lower_floor",
  "ascending_lower_commission",
  "ascending_request_recall",
  "ascending_force_recall",
  "ascending_pause",
  "ascending_revoke_payment_token",
  "ascending_withdraw_claim",
  "ascending_confirm_receipt",
  "ascending_release_funds",
  "ascending_abandon_reversal",
  "pay_verification_fee",
  "kar_pro_join",
  "kar_pro_leave",
  "passport_withdraw_claim",
  "staking_withdraw_claim",
  // Commerce / auction reads
  "listing_quote_buy",
  "fixed_price_consignment_phase",
  "ascending_consignment_phase",
  "auction_rules",
  "mandate_snapshot",
  "fixed_price_paused",
  "ascending_paused",
  "fixed_price_platform_fee_bps",
  "ascending_platform_fee_bps",
  "fixed_price_guardian",
  "ascending_guardian",
  "fixed_price_payment_tokens",
  "ascending_payment_token_enabled",
  "fixed_price_recall_cooldown",
  "ascending_recall_cooldown",
  "erc20_balance",
  "erc20_approve",
  "native_balance",
  "spl_mint_decimals",
  "fiat_price_feed",
  "claim_asset_meta",
  // Class C — EVM family on both namespaces (session-bound surfaces)
  "nostr_identity",
  "messaging_session",
  "nwc_lightning",
  "ens_profile",
] as const;

export type SurfaceCapability = (typeof SURFACE_CAPABILITIES)[number];

/** Class-C allowlist — only these may have SVM cell family "evm". */
export const SURFACE_CLASS_C_CAPABILITIES = [
  "nostr_identity",
  "messaging_session",
  "nwc_lightning",
  "ens_profile",
] as const satisfies readonly SurfaceCapability[];

/**
 * Chain-fact capability allowlist — only these may use evidence source "chain".
 */
export const SURFACE_CHAIN_FACT_CAPABILITIES = [
  "native_balance",
  "erc20_balance",
  "spl_mint_decimals",
  "pay_verification_fee",
] as const satisfies readonly SurfaceCapability[];

/**
 * Sole allowlist of chain evidence item labels.
 * Balance/decimals + pay_verification_fee transfer kinds only.
 */
export const SURFACE_CHAIN_EVIDENCE_ITEMS = [
  "lamports",
  "spl_token_account_amount",
  "spl_mint_decimals",
  "native_transfer",
  "spl_transfer",
] as const;

export type SurfaceChainEvidenceItem =
  (typeof SURFACE_CHAIN_EVIDENCE_ITEMS)[number];

export type SurfaceSupportCell =
  | { supported: true; family: "evm" | "svm" }
  | {
      supported: false;
      cause: "not_in_program" | "product_owner_owed" | "authority_only";
    };

export type SurfaceSupportResult =
  | SurfaceSupportCell
  | { unresolved: "unresolved_namespace" };

export type DerivedSurfaceClass = "A" | "B" | "C";

type SupportRow = Readonly<Record<CommercialVm, SurfaceSupportCell>>;

function dualVmOwner(): SupportRow {
  return {
    evm: { supported: true, family: "evm" },
    svm: { supported: true, family: "svm" },
  };
}

function productOwnerOwed(): SupportRow {
  return {
    evm: { supported: true, family: "evm" },
    svm: { supported: false, cause: "product_owner_owed" },
  };
}

function classCEvmOnBoth(): SupportRow {
  return {
    evm: { supported: true, family: "evm" },
    svm: { supported: true, family: "evm" },
  };
}

function createPassportRow(): SupportRow {
  return {
    evm: { supported: true, family: "evm" },
    svm: { supported: false, cause: "authority_only" },
  };
}

function notInProgramOnSvm(): SupportRow {
  return {
    evm: { supported: true, family: "evm" },
    svm: { supported: false, cause: "not_in_program" },
  };
}

/**
 * Derive fact class from the SVM cell — never stored beside the table.
 * A = in programs (supported svm | product_owner_owed | authority_only) or chain facts
 * B = not_in_program
 * C = supported with family evm on SVM (class-C allowlist only)
 */
export function deriveSurfaceClass(
  svmCell: SurfaceSupportCell,
): DerivedSurfaceClass {
  if (!svmCell.supported) {
    if (svmCell.cause === "not_in_program") return "B";
    return "A";
  }
  if (svmCell.family === "svm") return "A";
  return "C";
}

export function surfaceClassOf(
  capability: SurfaceCapability,
  table: SurfaceSupportTable = SURFACE_SUPPORT_TABLE,
): DerivedSurfaceClass {
  return deriveSurfaceClass(table[capability].svm);
}

/**
 * Per-capability support on each commercial VM family.
 * Injectable for policy plants — product callers use the live table via surfaceSupport.
 */
export const SURFACE_SUPPORT_TABLE: Readonly<
  Record<SurfaceCapability, SupportRow>
> = {
  set_passport_uri: dualVmOwner(),
  append_passport_record: dualVmOwner(),
  report_passport_discrepancy: dualVmOwner(),
  append_passport_attestation: dualVmOwner(),
  verify_passport: dualVmOwner(),
  open_challenge: dualVmOwner(),
  withdraw_challenge: dualVmOwner(),
  judge_challenge: dualVmOwner(),
  conclude_challenge: dualVmOwner(),
  ascending_open_challenge: productOwnerOwed(),
  ascending_withdraw_challenge: productOwnerOwed(),
  ascending_judge_challenge: productOwnerOwed(),
  ascending_conclude_challenge: productOwnerOwed(),
  set_verification_fee: dualVmOwner(),
  create_passport: createPassportRow(),
  custody_locked: dualVmOwner(),
  may_open_consignment: productOwnerOwed(),
  may_leave_chain: productOwnerOwed(),
  encumbrance_registry: productOwnerOwed(),
  challenge_bond_amount: dualVmOwner(),
  verification_fee: productOwnerOwed(),
  active_verifier: dualVmOwner(),
  passport_owner: productOwnerOwed(),
  passport_status: productOwnerOwed(),
  dispute_window: productOwnerOwed(),
  settlement_notes: productOwnerOwed(),
  hold_protection_ends_at: productOwnerOwed(),
  has_unresolved_settlement: productOwnerOwed(),
  // D-25 cross-program ApproveEscrow — product reader owed
  passport_approve: productOwnerOwed(),
  passport_approval_state: productOwnerOwed(),
  // ERC-721 setApprovalForAll has no SVM counterpart (approval = TransferDelegate / approved_for)
  passport_set_approval_for_all: notInProgramOnSvm(),
  bridge_send: productOwnerOwed(),
  fixed_price_open_direct: productOwnerOwed(),
  fixed_price_set_price: productOwnerOwed(),
  fixed_price_set_settlement_note: productOwnerOwed(),
  fixed_price_buy: productOwnerOwed(),
  fixed_price_owner_withdraw: productOwnerOwed(),
  fixed_price_confirm_external_payment: productOwnerOwed(),
  fixed_price_grant_mandate: productOwnerOwed(),
  fixed_price_revoke_mandate: productOwnerOwed(),
  fixed_price_lower_floor: productOwnerOwed(),
  fixed_price_lower_commission: productOwnerOwed(),
  fixed_price_request_recall: productOwnerOwed(),
  fixed_price_force_recall: productOwnerOwed(),
  fixed_price_pause: productOwnerOwed(),
  fixed_price_revoke_payment_token: productOwnerOwed(),
  fixed_price_withdraw_claim: productOwnerOwed(),
  ascending_open_direct: productOwnerOwed(),
  ascending_bid: productOwnerOwed(),
  ascending_cancel: notInProgramOnSvm(),
  ascending_settle: productOwnerOwed(),
  ascending_complete_reversal: productOwnerOwed(),
  ascending_grant_mandate: productOwnerOwed(),
  ascending_revoke_mandate: productOwnerOwed(),
  ascending_lower_floor: notInProgramOnSvm(),
  ascending_lower_commission: notInProgramOnSvm(),
  ascending_request_recall: notInProgramOnSvm(),
  ascending_force_recall: notInProgramOnSvm(),
  ascending_pause: productOwnerOwed(),
  ascending_revoke_payment_token: productOwnerOwed(),
  ascending_withdraw_claim: productOwnerOwed(),
  ascending_confirm_receipt: productOwnerOwed(),
  ascending_release_funds: productOwnerOwed(),
  ascending_abandon_reversal: productOwnerOwed(),
  // Native / SPL transfer — chain action, not a Kargain ix (product reader owed)
  pay_verification_fee: productOwnerOwed(),
  kar_pro_join: productOwnerOwed(),
  kar_pro_leave: productOwnerOwed(),
  passport_withdraw_claim: productOwnerOwed(),
  // ClaimStake exists on SVM; staking has no WithdrawClaim instruction.
  staking_withdraw_claim: notInProgramOnSvm(),
  listing_quote_buy: productOwnerOwed(),
  fixed_price_consignment_phase: productOwnerOwed(),
  ascending_consignment_phase: productOwnerOwed(),
  auction_rules: productOwnerOwed(),
  mandate_snapshot: productOwnerOwed(),
  fixed_price_paused: productOwnerOwed(),
  ascending_paused: productOwnerOwed(),
  fixed_price_platform_fee_bps: productOwnerOwed(),
  ascending_platform_fee_bps: productOwnerOwed(),
  fixed_price_guardian: productOwnerOwed(),
  ascending_guardian: productOwnerOwed(),
  fixed_price_payment_tokens: productOwnerOwed(),
  ascending_payment_token_enabled: productOwnerOwed(),
  fixed_price_recall_cooldown: productOwnerOwed(),
  ascending_recall_cooldown: notInProgramOnSvm(),
  // Chain facts readable on Solana — product reader owed
  erc20_balance: productOwnerOwed(),
  erc20_approve: productOwnerOwed(),
  native_balance: productOwnerOwed(),
  spl_mint_decimals: productOwnerOwed(),
  // D-07: fiat price via kargain-price / Pyth — product reader owed
  fiat_price_feed: productOwnerOwed(),
  claim_asset_meta: productOwnerOwed(),
  nostr_identity: classCEvmOnBoth(),
  messaging_session: classCEvmOnBoth(),
  nwc_lightning: classCEvmOnBoth(),
  ens_profile: classCEvmOnBoth(),
};

export type SurfaceSupportTable = typeof SURFACE_SUPPORT_TABLE;

/**
 * Sole reader: capability × commercial namespace → support cell or named absence.
 * VM comes from commercialActive — never invented, never `??` family default.
 */
export function surfaceSupport(
  capability: SurfaceCapability,
  namespace: number,
  registry?: CommercialRegistry,
  table: SurfaceSupportTable = SURFACE_SUPPORT_TABLE,
): SurfaceSupportResult {
  const stack = commercialActive(namespace, registry);
  if (stack == null) {
    return { unresolved: "unresolved_namespace" };
  }
  return table[capability][stack.vm];
}

export function isSurfaceCapability(value: string): value is SurfaceCapability {
  return (SURFACE_CAPABILITIES as readonly string[]).includes(value);
}

export function isSurfaceClassCCapability(
  capability: SurfaceCapability,
): boolean {
  return (SURFACE_CLASS_C_CAPABILITIES as readonly string[]).includes(
    capability,
  );
}

export function isSurfaceChainFactCapability(
  capability: SurfaceCapability,
): boolean {
  return (SURFACE_CHAIN_FACT_CAPABILITIES as readonly string[]).includes(
    capability,
  );
}

export function isSurfaceChainEvidenceItem(
  item: string,
): item is SurfaceChainEvidenceItem {
  return (SURFACE_CHAIN_EVIDENCE_ITEMS as readonly string[]).includes(item);
}

/**
 * Map derived pairs → fact/action capability ids from (abiId, functionName).
 * No file-path regex defaults. Session gates expand only to write actions
 * mapped from contract calls in the same file.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

import type { SurfaceCapability } from "@/lib/web3/surface-support";
import {
  SURFACE_SUPPORT_READ_PRIMITIVES,
  SURFACE_SUPPORT_SESSION_PRIMITIVES,
  SURFACE_SUPPORT_WRITE_PRIMITIVES,
  deriveSessionGatesWithoutWrites,
  type SurfaceConsumerPair,
} from "./surface-support-derive.ts";

export type CapabilityKind = "read_fact" | "write_action";

export const SURFACE_CAPABILITY_KIND: Readonly<
  Record<SurfaceCapability, CapabilityKind>
> = {
  set_passport_uri: "write_action",
  append_passport_record: "write_action",
  report_passport_discrepancy: "write_action",
  append_passport_attestation: "write_action",
  verify_passport: "write_action",
  open_challenge: "write_action",
  withdraw_challenge: "write_action",
  judge_challenge: "write_action",
  conclude_challenge: "write_action",
  ascending_open_challenge: "write_action",
  ascending_withdraw_challenge: "write_action",
  ascending_judge_challenge: "write_action",
  ascending_conclude_challenge: "write_action",
  set_verification_fee: "write_action",
  create_passport: "write_action",
  custody_locked: "read_fact",
  may_open_consignment: "read_fact",
  may_leave_chain: "read_fact",
  encumbrance_registry: "read_fact",
  challenge_bond_amount: "read_fact",
  verification_fee: "read_fact",
  active_verifier: "read_fact",
  passport_owner: "read_fact",
  passport_status: "read_fact",
  dispute_window: "read_fact",
  settlement_notes: "read_fact",
  hold_protection_ends_at: "read_fact",
  has_unresolved_settlement: "read_fact",
  passport_approve: "write_action",
  passport_approval_state: "read_fact",
  passport_set_approval_for_all: "write_action",
  bridge_send: "write_action",
  fixed_price_open_direct: "write_action",
  fixed_price_set_price: "write_action",
  fixed_price_set_settlement_note: "write_action",
  fixed_price_buy: "write_action",
  fixed_price_owner_withdraw: "write_action",
  fixed_price_confirm_external_payment: "write_action",
  fixed_price_grant_mandate: "write_action",
  fixed_price_revoke_mandate: "write_action",
  fixed_price_lower_floor: "write_action",
  fixed_price_lower_commission: "write_action",
  fixed_price_request_recall: "write_action",
  fixed_price_force_recall: "write_action",
  fixed_price_pause: "write_action",
  fixed_price_revoke_payment_token: "write_action",
  fixed_price_withdraw_claim: "write_action",
  ascending_open_direct: "write_action",
  ascending_bid: "write_action",
  ascending_cancel: "write_action",
  ascending_settle: "write_action",
  ascending_complete_reversal: "write_action",
  ascending_grant_mandate: "write_action",
  ascending_revoke_mandate: "write_action",
  ascending_lower_floor: "write_action",
  ascending_lower_commission: "write_action",
  ascending_request_recall: "write_action",
  ascending_force_recall: "write_action",
  ascending_pause: "write_action",
  ascending_revoke_payment_token: "write_action",
  ascending_withdraw_claim: "write_action",
  ascending_confirm_receipt: "write_action",
  ascending_release_funds: "write_action",
  ascending_abandon_reversal: "write_action",
  pay_verification_fee: "write_action",
  kar_pro_join: "write_action",
  kar_pro_leave: "write_action",
  passport_withdraw_claim: "write_action",
  staking_withdraw_claim: "write_action",
  listing_quote_buy: "read_fact",
  fixed_price_consignment_phase: "read_fact",
  ascending_consignment_phase: "read_fact",
  auction_rules: "read_fact",
  mandate_snapshot: "read_fact",
  fixed_price_paused: "read_fact",
  ascending_paused: "read_fact",
  fixed_price_platform_fee_bps: "read_fact",
  ascending_platform_fee_bps: "read_fact",
  fixed_price_guardian: "read_fact",
  ascending_guardian: "read_fact",
  fixed_price_payment_tokens: "read_fact",
  ascending_payment_token_enabled: "read_fact",
  fixed_price_recall_cooldown: "read_fact",
  ascending_recall_cooldown: "read_fact",
  erc20_balance: "read_fact",
  erc20_approve: "write_action",
  native_balance: "read_fact",
  spl_mint_decimals: "read_fact",
  fiat_price_feed: "read_fact",
  claim_asset_meta: "read_fact",
  nostr_identity: "write_action",
  messaging_session: "read_fact",
  nwc_lightning: "read_fact",
  ens_profile: "read_fact",
};

/** Capability from a concrete ABI family and EVM functionName. */
export const ABI_FN_TO_CAPABILITY: Readonly<
  Record<string, Partial<Record<string, SurfaceCapability>>>
> = {
  KarPassportAbi: {
    setPassportURI: "set_passport_uri",
    appendRecord: "append_passport_record",
    reportDiscrepancy: "report_passport_discrepancy",
    appendAttestation: "append_passport_attestation",
    verifyPassport: "verify_passport",
    mintPassport: "create_passport",
    open: "open_challenge",
    withdraw: "withdraw_challenge",
    judge: "judge_challenge",
    conclude: "conclude_challenge",
    custodyLocked: "custody_locked",
    may: "may_open_consignment",
    mayLeaveChain: "may_leave_chain",
    ownerOf: "passport_owner",
    getPassportStatus: "passport_status",
    passportStatus: "passport_status",
    DISPUTE_WINDOW: "dispute_window",
    disputeDeposit: "challenge_bond_amount",
    approve: "passport_approve",
    getApproved: "passport_approval_state",
    isApprovedForAll: "passport_approval_state",
    setApprovalForAll: "passport_set_approval_for_all",
    withdrawClaim: "passport_withdraw_claim",
  },
  KarPassportBridgeGatewayAbi: {
    send: "bridge_send",
  },
  FixedPriceConsignmentAbi: {
    openDirect: "fixed_price_open_direct",
    openFromMandate: "fixed_price_open_direct",
    setPrice: "fixed_price_set_price",
    setSettlementNote: "fixed_price_set_settlement_note",
    buy: "fixed_price_buy",
    ownerWithdraw: "fixed_price_owner_withdraw",
    agentWithdraw: "fixed_price_owner_withdraw",
    confirmExternalPayment: "fixed_price_confirm_external_payment",
    grant: "fixed_price_grant_mandate",
    revoke: "fixed_price_revoke_mandate",
    quoteBuy: "listing_quote_buy",
    consignmentAssetOf: "listing_quote_buy",
    settlementNotes: "settlement_notes",
    lowerFloor: "fixed_price_lower_floor",
    lowerCommission: "fixed_price_lower_commission",
    requestRecall: "fixed_price_request_recall",
    forceRecall: "fixed_price_force_recall",
    recallCooldown: "fixed_price_recall_cooldown",
    pause: "fixed_price_pause",
    unpause: "fixed_price_pause",
    revokePaymentToken: "fixed_price_revoke_payment_token",
    paused: "fixed_price_paused",
    platformFeeBps: "fixed_price_platform_fee_bps",
    withdrawClaim: "fixed_price_withdraw_claim",
    paymentTokens: "fixed_price_payment_tokens",
    guardian: "fixed_price_guardian",
    owner: "fixed_price_guardian",
    consignments: "fixed_price_consignment_phase",
    consignmentPhase: "fixed_price_consignment_phase",
    consignmentSellerOf: "fixed_price_consignment_phase",
    consignmentPriceOf: "fixed_price_consignment_phase",
    consignmentDenominationOf: "fixed_price_consignment_phase",
    consignmentFloorOf: "fixed_price_consignment_phase",
    consignmentCompensationFormOf: "fixed_price_consignment_phase",
    consignmentCommissionBpsOf: "fixed_price_consignment_phase",
    consignmentAgentOf: "fixed_price_consignment_phase",
    recallRequestTimestamp: "fixed_price_consignment_phase",
    mandates: "mandate_snapshot",
    mandateActive: "mandate_snapshot",
    mandateAgent: "mandate_snapshot",
    mandateExpiry: "mandate_snapshot",
    mandateAsset: "mandate_snapshot",
    mandateDenominationKind: "mandate_snapshot",
    mandateCurrencyCode: "mandate_snapshot",
    mandateFloor: "mandate_snapshot",
    mandateCompensationForm: "mandate_snapshot",
    mandateCommissionBps: "mandate_snapshot",
  },
  AscendingConsignmentAbi: {
    openAscendingDirect: "ascending_open_direct",
    openAscendingFromMandate: "ascending_open_direct",
    bid: "ascending_bid",
    settle: "ascending_settle",
    completeReversal: "ascending_complete_reversal",
    grant: "ascending_grant_mandate",
    revoke: "ascending_revoke_mandate",
    open: "ascending_open_challenge",
    judge: "ascending_judge_challenge",
    conclude: "ascending_conclude_challenge",
    withdraw: "ascending_withdraw_challenge",
    ownerWithdraw: "ascending_cancel",
    agentWithdraw: "ascending_cancel",
    lowerFloor: "ascending_lower_floor",
    lowerCommission: "ascending_lower_commission",
    requestRecall: "ascending_request_recall",
    forceRecall: "ascending_force_recall",
    recallCooldown: "ascending_recall_cooldown",
    pause: "ascending_pause",
    unpause: "ascending_pause",
    revokePaymentToken: "ascending_revoke_payment_token",
    paused: "ascending_paused",
    auctionRules: "auction_rules",
    windowDuration: "auction_rules",
    hasUnresolvedSettlement: "has_unresolved_settlement",
    holdProtectionEndsAt: "hold_protection_ends_at",
    platformFeeBps: "ascending_platform_fee_bps",
    withdrawClaim: "ascending_withdraw_claim",
    paymentTokenEnabled: "ascending_payment_token_enabled",
    guardian: "ascending_guardian",
    owner: "ascending_guardian",
    confirmReceipt: "ascending_confirm_receipt",
    releaseFunds: "ascending_release_funds",
    abandonReversal: "ascending_abandon_reversal",
    consignments: "ascending_consignment_phase",
    consignmentPhase: "ascending_consignment_phase",
    consignmentSellerOf: "ascending_consignment_phase",
    consignmentAgentOf: "ascending_consignment_phase",
    consignmentCommissionBpsOf: "ascending_consignment_phase",
    consignmentCompensationFormOf: "ascending_consignment_phase",
    consignmentPriceOf: "ascending_consignment_phase",
    consignmentFloorOf: "ascending_consignment_phase",
    recallRequestTimestamp: "ascending_consignment_phase",
    isBinding: "ascending_consignment_phase",
    mandates: "mandate_snapshot",
    mandateActive: "mandate_snapshot",
    mandateAgent: "mandate_snapshot",
    mandateExpiry: "mandate_snapshot",
    mandateAsset: "mandate_snapshot",
    mandateDenominationKind: "mandate_snapshot",
    mandateCurrencyCode: "mandate_snapshot",
    mandateFloor: "mandate_snapshot",
    mandateCompensationForm: "mandate_snapshot",
    mandateCommissionBps: "mandate_snapshot",
    auctionDuration: "auction_rules",
    consignmentOpenedAt: "auction_rules",
    auctionEndsAt: "auction_rules",
    auctionHighestBidder: "auction_rules",
    auctionHighestBid: "auction_rules",
    auctionMinIncrementBps: "auction_rules",
    auctionExtensionWindow: "auction_rules",
    holdBuyer: "hold_protection_ends_at",
    holdGross: "hold_protection_ends_at",
    holdReversalPending: "hold_protection_ends_at",
    holdAbandonmentDeadline: "hold_protection_ends_at",
    holdFrozenRemaining: "hold_protection_ends_at",
    auctionProtectionWindow: "hold_protection_ends_at",
    challengeOpenedAt: "has_unresolved_settlement",
    challengeChallenger: "has_unresolved_settlement",
    challengeWindowDuration: "has_unresolved_settlement",
    challengeBondAmount: "challenge_bond_amount",
  },
  KarProStakingAbi: {
    isActiveVerifier: "active_verifier",
    setVerificationFee: "set_verification_fee",
    verificationFee: "verification_fee",
    becomeVerifierNative: "kar_pro_join",
    join: "kar_pro_join",
    leave: "kar_pro_leave",
    stakes: "active_verifier",
    minStakeNative: "active_verifier",
    withdrawClaim: "staking_withdraw_claim",
  },
  KarProPassAbi: {
    getProPassData: "active_verifier",
  },
  erc20Abi: {
    balanceOf: "erc20_balance",
    // allowance is not a capability — mapped to same-file payment write in mapSurfacePairsToCapabilities
    approve: "erc20_approve",
    decimals: "spl_mint_decimals",
    symbol: "claim_asset_meta",
    transfer: "pay_verification_fee",
  },
  AGGREGATOR_V3_ABI: {
    latestRoundData: "fiat_price_feed",
  },
};

export const FRAGMENT_TO_CONCRETE = {
  commerceModeAbi: [
    "FixedPriceConsignmentAbi",
    "AscendingConsignmentAbi",
  ],
  claimablePayoutsAbi: [
    "FixedPriceConsignmentAbi",
    "AscendingConsignmentAbi",
    "KarPassportAbi",
    "KarProStakingAbi",
  ],
} as const;

export function assertNoFragmentKeysInMap(
  map: Readonly<Record<string, unknown>> = ABI_FN_TO_CAPABILITY,
): void {
  for (const fragment of Object.keys(FRAGMENT_TO_CONCRETE)) {
    assert.equal(
      Object.hasOwn(map, fragment),
      false,
      `fragment ABI key forbidden in ABI_FN_TO_CAPABILITY: ${fragment}`,
    );
  }
}

assertNoFragmentKeysInMap();

export type SurfaceCorrespondence = {
  abiId: string;
  evmFunction: string;
  /** One enum = same-program; multiple = cross-program (requires divergenceId) */
  svmEnums: readonly string[];
  svmVariant: string;
  divergenceId?: string;
};

export const SURFACE_CORRESPONDENCE = [
  { abiId: "KarPassportAbi", evmFunction: "setPassportURI", svmEnums: ["PassportIx"], svmVariant: "SetPassportUri" },
  { abiId: "KarPassportAbi", evmFunction: "open", svmEnums: ["PassportIx"], svmVariant: "OpenChallenge" },
  { abiId: "KarPassportAbi", evmFunction: "withdraw", svmEnums: ["PassportIx"], svmVariant: "WithdrawChallenge" },
  { abiId: "KarPassportAbi", evmFunction: "judge", svmEnums: ["PassportIx"], svmVariant: "JudgeChallenge" },
  { abiId: "KarPassportAbi", evmFunction: "conclude", svmEnums: ["PassportIx"], svmVariant: "ConcludeChallenge" },
  { abiId: "AscendingConsignmentAbi", evmFunction: "open", svmEnums: ["AscendingIx"], svmVariant: "OpenChallenge" },
  { abiId: "AscendingConsignmentAbi", evmFunction: "withdraw", svmEnums: ["AscendingIx"], svmVariant: "WithdrawChallenge" },
  { abiId: "AscendingConsignmentAbi", evmFunction: "judge", svmEnums: ["AscendingIx"], svmVariant: "JudgeChallenge" },
  { abiId: "AscendingConsignmentAbi", evmFunction: "conclude", svmEnums: ["AscendingIx"], svmVariant: "ConcludeChallenge" },
  { abiId: "KarProStakingAbi", evmFunction: "becomeVerifierNative", svmEnums: ["StakingIx"], svmVariant: "Join" },
  { abiId: "KarProStakingAbi", evmFunction: "join", svmEnums: ["StakingIx"], svmVariant: "Join" },
  { abiId: "KarPassportBridgeGatewayAbi", evmFunction: "send", svmEnums: ["GatewayIx"], svmVariant: "Send" },
  { abiId: "KarProStakingAbi", evmFunction: "setVerificationFee", svmEnums: ["StakingIx"], svmVariant: "SetVerificationFee" },
  { abiId: "KarProStakingAbi", evmFunction: "leave", svmEnums: ["StakingIx"], svmVariant: "Leave" },
  { abiId: "KarPassportAbi", evmFunction: "approve", svmEnums: ["FixedPriceIx", "AscendingIx"], svmVariant: "ApproveEscrow", divergenceId: "D-25" },
  { abiId: "KarPassportAbi", evmFunction: "getApproved", svmEnums: ["FixedPriceIx", "AscendingIx"], svmVariant: "ApproveEscrow", divergenceId: "D-25" },
  { abiId: "KarPassportAbi", evmFunction: "isApprovedForAll", svmEnums: ["FixedPriceIx", "AscendingIx"], svmVariant: "ApproveEscrow", divergenceId: "D-25" },
] as const satisfies readonly SurfaceCorrespondence[];

export function correspondenceFor(
  abiId: string,
  fn: string,
): SurfaceCorrespondence | undefined {
  return SURFACE_CORRESPONDENCE.find(
    (row) => row.abiId === abiId && row.evmFunction === fn,
  );
}

export const CAPABILITY_BOUND_ENUM: Partial<
  Record<SurfaceCapability, string>
> = {
  set_passport_uri: "PassportIx",
  append_passport_record: "PassportIx",
  report_passport_discrepancy: "PassportIx",
  append_passport_attestation: "PassportIx",
  verify_passport: "PassportIx",
  open_challenge: "PassportIx",
  withdraw_challenge: "PassportIx",
  judge_challenge: "PassportIx",
  conclude_challenge: "PassportIx",
  ascending_open_challenge: "AscendingIx",
  ascending_withdraw_challenge: "AscendingIx",
  ascending_judge_challenge: "AscendingIx",
  ascending_conclude_challenge: "AscendingIx",
  create_passport: "PassportIx",
  set_verification_fee: "StakingIx",
  custody_locked: "PassportIx",
  may_open_consignment: "PassportIx",
  may_leave_chain: "PassportIx",
  encumbrance_registry: "PassportIx",
  verification_fee: "StakingIx",
  active_verifier: "StakingIx",
  passport_owner: "PassportIx",
  passport_status: "PassportIx",
  dispute_window: "PassportIx",
  settlement_notes: "FixedPriceIx",
  hold_protection_ends_at: "AscendingIx",
  has_unresolved_settlement: "AscendingIx",
  passport_set_approval_for_all: "PassportIx",
  bridge_send: "GatewayIx",
  fixed_price_open_direct: "FixedPriceIx",
  fixed_price_set_price: "FixedPriceIx",
  fixed_price_set_settlement_note: "FixedPriceIx",
  fixed_price_buy: "FixedPriceIx",
  fixed_price_owner_withdraw: "FixedPriceIx",
  fixed_price_confirm_external_payment: "FixedPriceIx",
  fixed_price_grant_mandate: "FixedPriceIx",
  fixed_price_revoke_mandate: "FixedPriceIx",
  fixed_price_lower_floor: "FixedPriceIx",
  fixed_price_lower_commission: "FixedPriceIx",
  fixed_price_request_recall: "FixedPriceIx",
  fixed_price_force_recall: "FixedPriceIx",
  fixed_price_pause: "FixedPriceIx",
  fixed_price_revoke_payment_token: "FixedPriceIx",
  fixed_price_withdraw_claim: "FixedPriceIx",
  listing_quote_buy: "FixedPriceIx",
  fixed_price_consignment_phase: "FixedPriceIx",
  mandate_snapshot: "FixedPriceIx",
  fiat_price_feed: "FixedPriceIx",
  claim_asset_meta: "FixedPriceIx",
  fixed_price_paused: "FixedPriceIx",
  fixed_price_platform_fee_bps: "FixedPriceIx",
  fixed_price_guardian: "FixedPriceIx",
  fixed_price_payment_tokens: "FixedPriceIx",
  fixed_price_recall_cooldown: "FixedPriceIx",
  ascending_open_direct: "AscendingIx",
  ascending_bid: "AscendingIx",
  ascending_cancel: "AscendingIx",
  ascending_settle: "AscendingIx",
  ascending_complete_reversal: "AscendingIx",
  ascending_grant_mandate: "AscendingIx",
  ascending_revoke_mandate: "AscendingIx",
  ascending_lower_floor: "AscendingIx",
  ascending_lower_commission: "AscendingIx",
  ascending_request_recall: "AscendingIx",
  ascending_force_recall: "AscendingIx",
  ascending_pause: "AscendingIx",
  ascending_revoke_payment_token: "AscendingIx",
  ascending_withdraw_claim: "AscendingIx",
  ascending_confirm_receipt: "AscendingIx",
  ascending_release_funds: "AscendingIx",
  ascending_abandon_reversal: "AscendingIx",
  auction_rules: "AscendingIx",
  ascending_consignment_phase: "AscendingIx",
  ascending_paused: "AscendingIx",
  ascending_platform_fee_bps: "AscendingIx",
  ascending_guardian: "AscendingIx",
  ascending_payment_token_enabled: "AscendingIx",
  ascending_recall_cooldown: "AscendingIx",
  kar_pro_join: "StakingIx",
  kar_pro_leave: "StakingIx",
  passport_withdraw_claim: "PassportIx",
  staking_withdraw_claim: "StakingIx",
};

type AbiStateMutability = "pure" | "view" | "nonpayable" | "payable";

const CONCRETE_MUTABILITY_EXPORTS = new Set([
  "FixedPriceConsignmentAbi",
  "AscendingConsignmentAbi",
  "KarPassportAbi",
  "KarProStakingAbi",
  "KarPassportBridgeGatewayAbi",
  "KarProPassAbi",
]);

let abiMutabilityCache: ReadonlyMap<string, AbiStateMutability> | null = null;

function unwrapExpression(expression: ts.Expression): ts.Expression {
  if (ts.isAsExpression(expression) || ts.isSatisfiesExpression(expression)) {
    return unwrapExpression(expression.expression);
  }
  return expression;
}

function stringProperty(
  object: ts.ObjectLiteralExpression,
  propertyName: string,
): string | null {
  for (const property of object.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    const name = ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)
      ? property.name.text
      : property.name.getText();
    if (name !== propertyName) continue;
    const value = unwrapExpression(property.initializer);
    if (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)) {
      return value.text;
    }
  }
  return null;
}

function loadAbiMutability(): ReadonlyMap<string, AbiStateMutability> {
  if (abiMutabilityCache) return abiMutabilityCache;
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const file = path.join(root, "lib/contracts/abis.generated.ts");
  const source = ts.createSourceFile(
    file,
    fs.readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const result = new Map<string, AbiStateMutability>();
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (
        !ts.isIdentifier(declaration.name) ||
        !CONCRETE_MUTABILITY_EXPORTS.has(declaration.name.text) ||
        !declaration.initializer
      ) {
        continue;
      }
      const initializer = unwrapExpression(declaration.initializer);
      if (!ts.isArrayLiteralExpression(initializer)) continue;
      for (const element of initializer.elements) {
        const item = unwrapExpression(element as ts.Expression);
        if (!ts.isObjectLiteralExpression(item)) continue;
        if (stringProperty(item, "type") !== "function") continue;
        const fn = stringProperty(item, "name");
        const mutability = stringProperty(item, "stateMutability");
        if (
          fn &&
          (mutability === "pure" ||
            mutability === "view" ||
            mutability === "nonpayable" ||
            mutability === "payable")
        ) {
          result.set(`${declaration.name.text}::${fn}`, mutability);
        }
      }
    }
  }
  for (const fn of ["balanceOf", "allowance", "decimals", "symbol"]) {
    result.set(`erc20Abi::${fn}`, "view");
  }
  result.set("AGGREGATOR_V3_ABI::latestRoundData", "view");
  abiMutabilityCache = result;
  return result;
}

function stateMutabilityFor(
  abiId: string | null | undefined,
  functionName: string | null | undefined,
): AbiStateMutability | undefined {
  if (!abiId || !functionName) return undefined;
  return loadAbiMutability().get(`${abiId}::${functionName}`);
}

/** Known session-gate files with no write calls — reported, not invented. */
export const KNOWN_SESSION_GATES_WITHOUT_WRITES: readonly string[] = [
  "components/auction/auction-detail-client-island.tsx",
  "components/claims/claims-pending-banner.tsx",
  "components/identity/identity-header.tsx",
  "components/marketplace/listing-detail-client-island.tsx",
  "components/marketplace/listing-make-offer-button.tsx",
  "components/marketplace/nostr-comments-section.tsx",
  "components/marketplace/seller-contact-button.tsx",
  "components/notifications/notifications-unread-badge.tsx",
  "components/passport/edit-passport-wizard.tsx",
  "components/passport/passport-actions-panel.tsx",
  "components/passport/passport-bridge-panel.tsx",
  "components/passport/passport-detail-tabs.tsx",
  "components/passport/passport-sell-panel.tsx",
  "components/profile/karpro-status-widget.tsx",
  "components/profile/lightning-wallet-section.tsx",
  "components/profile/messaging-settings-section.tsx",
  "components/profile/profile-edit-client.tsx",
  "components/profile/profile-page.tsx",
  "components/profile/profile-verifier-stats-band.tsx",
  "components/providers/messaging-session-provider.tsx",
  "components/providers/wallet-session-sync.tsx",
  "components/providers/xmtp-conversations-provider.tsx",
  "components/shell/app-top-nav.tsx",
  "components/shell/mobile-bottom-nav.tsx",
  "components/verifier/verification-request-button.tsx",
  "components/wallet-login-button.tsx",
  "components/watchlist/watchlist-button.tsx",
  "components/watchlist/watchlist-client.tsx",
  "hooks/use-bridge-transit.ts",
  "hooks/use-commerce-pause-ops.ts",
  "hooks/use-commerce-revoke-ops.ts",
  "hooks/use-is-commerce-guardian.ts",
  "hooks/use-is-profile-owner.ts",
  "hooks/use-nostr-key.tsx",
  "hooks/use-nostr-notifications-sub.ts",
  "hooks/use-notification-state.tsx",
  "hooks/use-nwc-wallet.ts",
  "hooks/use-owned-passport-token-ids.ts",
  "hooks/use-pending-claims.ts",
  "hooks/use-ponder-notifications.ts",
  "hooks/use-show-become-karpro.ts",
  "hooks/use-watchlist-notifications.ts",
  "hooks/use-watchlist.ts",
];

/** Payment write actions that may absorb an ERC-20 allowance read in the same file. */
export const PAYMENT_WRITE_CAPABILITIES = [
  "fixed_price_buy",
  "ascending_bid",
] as const satisfies readonly SurfaceCapability[];

export function isErc20AbiFamily(abiId: string | null): boolean {
  return abiId === "erc20Abi";
}

export function capabilityFromAbiAndFunction(
  abiId: string | null,
  functionName: string,
): SurfaceCapability | null {
  // allowance is absorbed into payment writes — not a standalone capability
  if (functionName === "allowance" && isErc20AbiFamily(abiId)) {
    return null;
  }
  if (abiId != null) {
    const byFn = ABI_FN_TO_CAPABILITY[abiId];
    if (byFn?.[functionName] != null) return byFn[functionName]!;
  }
  return null;
}

/**
 * Kind safety: read→write_action is illegal except ERC-20 `allowance` absorbed
 * into a same-file payment write (fixed_price_buy / ascending_bid).
 */
export function assertKindSafe(
  primitive: string,
  capability: SurfaceCapability,
  ctx?: {
    abiId?: string | null;
    functionName?: string | null;
    sameFilePaymentWrite?: boolean;
  },
): void {
  const kind = SURFACE_CAPABILITY_KIND[capability];
  const allowanceException =
    isErc20AbiFamily(ctx?.abiId ?? null) &&
    ctx?.functionName === "allowance" &&
    ctx.sameFilePaymentWrite === true &&
    (PAYMENT_WRITE_CAPABILITIES as readonly string[]).includes(capability);
  const stateMutability = stateMutabilityFor(
    ctx?.abiId,
    ctx?.functionName,
  );
  if (
    (stateMutability === "view" || stateMutability === "pure") &&
    kind === "write_action" &&
    ctx?.functionName !== "allowance" &&
    !allowanceException
  ) {
    assert.fail(
      `ABI view mapped to write_action: ${ctx?.abiId}.${ctx?.functionName} → ${capability}`,
    );
  }
  if (SURFACE_SUPPORT_READ_PRIMITIVES.has(primitive) && kind !== "read_fact") {
    if (!allowanceException) {
      assert.fail(
        `kind mismatch: read primitive ${primitive} → write_action ${capability}`,
      );
    }
    return;
  }
  if (
    SURFACE_SUPPORT_WRITE_PRIMITIVES.has(primitive) &&
    kind !== "write_action"
  ) {
    assert.fail(
      `kind mismatch: write primitive ${primitive} → read_fact ${capability}`,
    );
  }
}

export type MappedCensusPair = SurfaceConsumerPair & {
  capability: SurfaceCapability;
};

/**
 * Map derived pairs by (abiId, functionName). Session/lifecycle primitives
 * expand to write actions already mapped for the file. useBalance → native_balance.
 * Migrated lib owners contribute their ForCapability literal as a write action
 * so session/txWriteAvailability pairs in those files expand correctly.
 * ERC-20 allowance reads map to same-file payment writes only.
 */
export function mapSurfacePairsToCapabilities(
  derived: readonly SurfaceConsumerPair[],
  sources?: ReadonlyMap<string, string>,
): {
  mapped: MappedCensusPair[];
  sessionGatesWithoutWrites: string[];
  unmappedContractCalls: SurfaceConsumerPair[];
} {
  const byFileWrites = new Map<string, Set<SurfaceCapability>>();
  const mapped: MappedCensusPair[] = [];
  const unmappedContractCalls: SurfaceConsumerPair[] = [];
  const seen = new Set<string>();
  const allowanceReads: SurfaceConsumerPair[] = [];

  const noteWrite = (file: string, capability: SurfaceCapability) => {
    if (SURFACE_CAPABILITY_KIND[capability] !== "write_action") return;
    let set = byFileWrites.get(file);
    if (!set) {
      set = new Set();
      byFileWrites.set(file, set);
    }
    set.add(capability);
  };

  if (sources) {
    for (const [file, text] of sources) {
      const cap = capabilityFromMigratedOwnerSource(file, text);
      if (cap != null) noteWrite(file, cap);
    }
  }

  const pushMapped = (
    pair: SurfaceConsumerPair,
    capability: SurfaceCapability,
    kindCtx?: {
      abiId?: string | null;
      functionName?: string | null;
      sameFilePaymentWrite?: boolean;
    },
  ) => {
    try {
      assertKindSafe(pair.primitive, capability, {
        abiId: pair.abiId,
        functionName: pair.functionName,
        ...kindCtx,
      });
    } catch {
      unmappedContractCalls.push(pair);
      return;
    }
    const key = `${pair.file}::${pair.primitive}::${pair.functionName ?? ""}::${pair.abiId ?? ""}::${capability}`;
    if (seen.has(key)) return;
    seen.add(key);
    mapped.push({ ...pair, capability });
    noteWrite(pair.file, capability);
  };

  for (const pair of derived) {
    if (
      SURFACE_SUPPORT_SESSION_PRIMITIVES.has(pair.primitive) ||
      pair.primitive === "runTx(" ||
      pair.primitive === "awaitReceipt("
    ) {
      continue;
    }

    if (pair.primitive === "useBalance") {
      pushMapped(pair, "native_balance");
      continue;
    }

    if (pair.primitive === "useSignMessage") {
      continue;
    }

    if (
      pair.functionName === "allowance" &&
      isErc20AbiFamily(pair.abiId)
    ) {
      allowanceReads.push(pair);
      continue;
    }

    if (pair.functionName == null) {
      if (pair.abiId != null) unmappedContractCalls.push(pair);
      continue;
    }

    const concreteAbiIds =
      pair.abiId != null &&
      Object.hasOwn(FRAGMENT_TO_CONCRETE, pair.abiId)
        ? FRAGMENT_TO_CONCRETE[
            pair.abiId as keyof typeof FRAGMENT_TO_CONCRETE
          ]
        : pair.abiId != null
          ? [pair.abiId]
          : [];
    let matched = false;
    for (const concreteAbiId of concreteAbiIds) {
      const cap = capabilityFromAbiAndFunction(
        concreteAbiId,
        pair.functionName,
      );
      if (cap == null) continue;
      matched = true;
      pushMapped(
        { ...pair, abiId: concreteAbiId },
        cap,
        { abiId: concreteAbiId, functionName: pair.functionName },
      );
    }
    if (!matched) {
      unmappedContractCalls.push(pair);
    }
  }

  // Absorb allowance reads into same-file payment writes
  for (const pair of allowanceReads) {
    const payments = [...(byFileWrites.get(pair.file) ?? [])].filter((c) =>
      (PAYMENT_WRITE_CAPABILITIES as readonly string[]).includes(c),
    );
    if (payments.length === 0) {
      unmappedContractCalls.push(pair);
      continue;
    }
    for (const capability of payments) {
      pushMapped(pair, capability, {
        abiId: pair.abiId,
        functionName: "allowance",
        sameFilePaymentWrite: true,
      });
    }
  }

  for (const pair of derived) {
    const isSession =
      SURFACE_SUPPORT_SESSION_PRIMITIVES.has(pair.primitive) ||
      pair.primitive === "runTx(" ||
      pair.primitive === "awaitReceipt(" ||
      pair.primitive === "useSignMessage" ||
      pair.primitive === "txWriteAvailability";
    if (!isSession) continue;

    const actions = [...(byFileWrites.get(pair.file) ?? [])];
    if (actions.length === 0) continue;

    for (const capability of actions) {
      if (
        pair.primitive === "runTx(" ||
        pair.primitive === "awaitReceipt(" ||
        pair.primitive === "useSignMessage"
      ) {
        if (SURFACE_CAPABILITY_KIND[capability] !== "write_action") continue;
      }
      pushMapped(pair, capability);
    }
  }

  const sessionGatesWithoutWrites = deriveSessionGatesWithoutWrites(
    new Set(byFileWrites.keys()),
    derived,
  );

  mapped.sort((a, b) => {
    const ka = `${a.file}::${a.primitive}::${a.functionName ?? ""}::${a.capability}`;
    const kb = `${b.file}::${b.primitive}::${b.functionName ?? ""}::${b.capability}`;
    return ka.localeCompare(kb);
  });

  return { mapped, sessionGatesWithoutWrites, unmappedContractCalls };
}

/** Capability for dual-VM lib owners from ForCapability string literal in source. */
export function capabilityFromMigratedOwnerSource(
  file: string,
  text: string,
): SurfaceCapability | null {
  if (file.includes("prepare-passport-edit-write")) return "set_passport_uri";
  if (file.includes("prepare-passport-record-write")) {
    return "append_passport_record";
  }
  const m = text.match(
    /txWriteAvailabilityForCapability\s*\(\s*[^,]+,\s*"([a-z0-9_]+)"/,
  );
  if (!m) return null;
  return m[1] as SurfaceCapability;
}

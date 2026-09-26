/**
 * S8-D0 surface-support census fixture — regenerated.
 * Class-B evidence items are derived live (never stored).
 * Write counterparts are derived (stored ix evidence deleted).
 * Program-bound capabilities; fragment ABIs expanded.
 */
import type { SurfaceCapability } from "@/lib/web3/surface-support";

export type SurfaceCensusPair = {
  file: string;
  primitive: string;
  functionName: string | null;
  capability: SurfaceCapability;
};

/** Class-A evidence. Class B/C use null (B items derived at assert time). */
export type ForeignFieldItem = {
  program: string;
  type: string;
  field: string;
};

export type SurfaceEvidence =
  | {
      source: "ix" | "state" | "struct_field" | "const" | "chain";
      /** One label, or several for multi-item chain facts (pay_verification_fee). */
      item: string | readonly string[];
    }
  | {
      source: "foreign_field";
      item: ForeignFieldItem;
    };

export type SurfaceCensusCapabilityMeta = {
  id: SurfaceCapability;
  kind: "read_fact" | "write_action";
  evmSource: string;
  evidence: SurfaceEvidence | null;
  svmReader: string | null;
  observedSvmBehaviour: string | null;
};

export const SURFACE_CENSUS_PAIRS: SurfaceCensusPair[] = [
  {
    "file": "components/auction/agent-create-auction-panel.tsx",
    "primitive": "requireEvmSession",
    "functionName": null,
    "capability": "ascending_open_direct"
  },
  {
    "file": "components/auction/agent-create-auction-panel.tsx",
    "primitive": "runTx(",
    "functionName": null,
    "capability": "ascending_open_direct"
  },
  {
    "file": "components/auction/agent-create-auction-panel.tsx",
    "primitive": "useReadContract",
    "functionName": "passportStatus",
    "capability": "passport_status"
  },
  {
    "file": "components/auction/agent-create-auction-panel.tsx",
    "primitive": "writeContractAsync",
    "functionName": "openAscendingFromMandate",
    "capability": "ascending_open_direct"
  },
  {
    "file": "components/auction/auction-bid-panel.tsx",
    "primitive": "awaitReceipt(",
    "functionName": null,
    "capability": "ascending_bid"
  },
  {
    "file": "components/auction/auction-bid-panel.tsx",
    "primitive": "awaitReceipt(",
    "functionName": null,
    "capability": "erc20_approve"
  },
  {
    "file": "components/auction/auction-bid-panel.tsx",
    "primitive": "requireEvmSession",
    "functionName": null,
    "capability": "ascending_bid"
  },
  {
    "file": "components/auction/auction-bid-panel.tsx",
    "primitive": "requireEvmSession",
    "functionName": null,
    "capability": "erc20_approve"
  },
  {
    "file": "components/auction/auction-bid-panel.tsx",
    "primitive": "runTx(",
    "functionName": null,
    "capability": "ascending_bid"
  },
  {
    "file": "components/auction/auction-bid-panel.tsx",
    "primitive": "runTx(",
    "functionName": null,
    "capability": "erc20_approve"
  },
  {
    "file": "components/auction/auction-bid-panel.tsx",
    "primitive": "useBalance",
    "functionName": null,
    "capability": "native_balance"
  },
  {
    "file": "components/auction/auction-bid-panel.tsx",
    "primitive": "useReadContract",
    "functionName": "allowance",
    "capability": "ascending_bid"
  },
  {
    "file": "components/auction/auction-bid-panel.tsx",
    "primitive": "useReadContract",
    "functionName": "balanceOf",
    "capability": "erc20_balance"
  },
  {
    "file": "components/auction/auction-bid-panel.tsx",
    "primitive": "writeContractAsync",
    "functionName": "approve",
    "capability": "erc20_approve"
  },
  {
    "file": "components/auction/auction-bid-panel.tsx",
    "primitive": "writeContractAsync",
    "functionName": "bid",
    "capability": "ascending_bid"
  },
  {
    "file": "components/auction/auction-cancel-panel.tsx",
    "primitive": "requireEvmSession",
    "functionName": null,
    "capability": "ascending_cancel"
  },
  {
    "file": "components/auction/auction-cancel-panel.tsx",
    "primitive": "runTx(",
    "functionName": null,
    "capability": "ascending_cancel"
  },
  {
    "file": "components/auction/auction-cancel-panel.tsx",
    "primitive": "writeContractAsync",
    "functionName": "agentWithdraw",
    "capability": "ascending_cancel"
  },
  {
    "file": "components/auction/auction-cancel-panel.tsx",
    "primitive": "writeContractAsync",
    "functionName": "ownerWithdraw",
    "capability": "ascending_cancel"
  },
  {
    "file": "components/auction/auction-detail-client-island.tsx",
    "primitive": "useReadContract",
    "functionName": "decimals",
    "capability": "spl_mint_decimals"
  },
  {
    "file": "components/auction/auction-finalize-panel.tsx",
    "primitive": "requireEvmSession",
    "functionName": null,
    "capability": "ascending_settle"
  },
  {
    "file": "components/auction/auction-finalize-panel.tsx",
    "primitive": "runTx(",
    "functionName": null,
    "capability": "ascending_settle"
  },
  {
    "file": "components/auction/auction-finalize-panel.tsx",
    "primitive": "writeContractAsync",
    "functionName": "settle",
    "capability": "ascending_settle"
  },
  {
    "file": "components/auction/auction-settlement-panel.tsx",
    "primitive": "requireEvmSession",
    "functionName": null,
    "capability": "ascending_abandon_reversal"
  },
  {
    "file": "components/auction/auction-settlement-panel.tsx",
    "primitive": "requireEvmSession",
    "functionName": null,
    "capability": "ascending_complete_reversal"
  },
  {
    "file": "components/auction/auction-settlement-panel.tsx",
    "primitive": "requireEvmSession",
    "functionName": null,
    "capability": "ascending_conclude_challenge"
  },
  {
    "file": "components/auction/auction-settlement-panel.tsx",
    "primitive": "requireEvmSession",
    "functionName": null,
    "capability": "ascending_confirm_receipt"
  },
  {
    "file": "components/auction/auction-settlement-panel.tsx",
    "primitive": "requireEvmSession",
    "functionName": null,
    "capability": "ascending_judge_challenge"
  },
  {
    "file": "components/auction/auction-settlement-panel.tsx",
    "primitive": "requireEvmSession",
    "functionName": null,
    "capability": "ascending_open_challenge"
  },
  {
    "file": "components/auction/auction-settlement-panel.tsx",
    "primitive": "requireEvmSession",
    "functionName": null,
    "capability": "ascending_release_funds"
  },
  {
    "file": "components/auction/auction-settlement-panel.tsx",
    "primitive": "requireEvmSession",
    "functionName": null,
    "capability": "ascending_withdraw_challenge"
  },
  {
    "file": "components/auction/auction-settlement-panel.tsx",
    "primitive": "runTx(",
    "functionName": null,
    "capability": "ascending_abandon_reversal"
  },
  {
    "file": "components/auction/auction-settlement-panel.tsx",
    "primitive": "runTx(",
    "functionName": null,
    "capability": "ascending_complete_reversal"
  },
  {
    "file": "components/auction/auction-settlement-panel.tsx",
    "primitive": "runTx(",
    "functionName": null,
    "capability": "ascending_conclude_challenge"
  },
  {
    "file": "components/auction/auction-settlement-panel.tsx",
    "primitive": "runTx(",
    "functionName": null,
    "capability": "ascending_confirm_receipt"
  },
  {
    "file": "components/auction/auction-settlement-panel.tsx",
    "primitive": "runTx(",
    "functionName": null,
    "capability": "ascending_judge_challenge"
  },
  {
    "file": "components/auction/auction-settlement-panel.tsx",
    "primitive": "runTx(",
    "functionName": null,
    "capability": "ascending_open_challenge"
  },
  {
    "file": "components/auction/auction-settlement-panel.tsx",
    "primitive": "runTx(",
    "functionName": null,
    "capability": "ascending_release_funds"
  },
  {
    "file": "components/auction/auction-settlement-panel.tsx",
    "primitive": "runTx(",
    "functionName": null,
    "capability": "ascending_withdraw_challenge"
  },
  {
    "file": "components/auction/auction-settlement-panel.tsx",
    "primitive": "writeContractAsync",
    "functionName": "abandonReversal",
    "capability": "ascending_abandon_reversal"
  },
  {
    "file": "components/auction/auction-settlement-panel.tsx",
    "primitive": "writeContractAsync",
    "functionName": "completeReversal",
    "capability": "ascending_complete_reversal"
  },
  {
    "file": "components/auction/auction-settlement-panel.tsx",
    "primitive": "writeContractAsync",
    "functionName": "conclude",
    "capability": "ascending_conclude_challenge"
  },
  {
    "file": "components/auction/auction-settlement-panel.tsx",
    "primitive": "writeContractAsync",
    "functionName": "confirmReceipt",
    "capability": "ascending_confirm_receipt"
  },
  {
    "file": "components/auction/auction-settlement-panel.tsx",
    "primitive": "writeContractAsync",
    "functionName": "judge",
    "capability": "ascending_judge_challenge"
  },
  {
    "file": "components/auction/auction-settlement-panel.tsx",
    "primitive": "writeContractAsync",
    "functionName": "open",
    "capability": "ascending_open_challenge"
  },
  {
    "file": "components/auction/auction-settlement-panel.tsx",
    "primitive": "writeContractAsync",
    "functionName": "releaseFunds",
    "capability": "ascending_release_funds"
  },
  {
    "file": "components/auction/auction-settlement-panel.tsx",
    "primitive": "writeContractAsync",
    "functionName": "withdraw",
    "capability": "ascending_withdraw_challenge"
  },
  {
    "file": "components/auction/authorize-auction-agent-dialog.tsx",
    "primitive": "requireEvmSession",
    "functionName": null,
    "capability": "ascending_grant_mandate"
  },
  {
    "file": "components/auction/authorize-auction-agent-dialog.tsx",
    "primitive": "requireEvmSession",
    "functionName": null,
    "capability": "ascending_revoke_mandate"
  },
  {
    "file": "components/auction/authorize-auction-agent-dialog.tsx",
    "primitive": "runTx(",
    "functionName": null,
    "capability": "ascending_grant_mandate"
  },
  {
    "file": "components/auction/authorize-auction-agent-dialog.tsx",
    "primitive": "runTx(",
    "functionName": null,
    "capability": "ascending_revoke_mandate"
  },
  {
    "file": "components/auction/authorize-auction-agent-dialog.tsx",
    "primitive": "useReadContract",
    "functionName": "hasUnresolvedSettlement",
    "capability": "has_unresolved_settlement"
  },
  {
    "file": "components/auction/authorize-auction-agent-dialog.tsx",
    "primitive": "useReadContract",
    "functionName": "holdProtectionEndsAt",
    "capability": "hold_protection_ends_at"
  },
  {
    "file": "components/auction/authorize-auction-agent-dialog.tsx",
    "primitive": "writeContractAsync",
    "functionName": "grant",
    "capability": "ascending_grant_mandate"
  },
  {
    "file": "components/auction/authorize-auction-agent-dialog.tsx",
    "primitive": "writeContractAsync",
    "functionName": "revoke",
    "capability": "ascending_revoke_mandate"
  },
  {
    "file": "components/auction/create-auction-panel.tsx",
    "primitive": "requireEvmSession",
    "functionName": null,
    "capability": "ascending_open_direct"
  },
  {
    "file": "components/auction/create-auction-panel.tsx",
    "primitive": "runTx(",
    "functionName": null,
    "capability": "ascending_open_direct"
  },
  {
    "file": "components/auction/create-auction-panel.tsx",
    "primitive": "useReadContract",
    "functionName": "hasUnresolvedSettlement",
    "capability": "has_unresolved_settlement"
  },
  {
    "file": "components/auction/create-auction-panel.tsx",
    "primitive": "useReadContract",
    "functionName": "holdProtectionEndsAt",
    "capability": "hold_protection_ends_at"
  },
  {
    "file": "components/auction/create-auction-panel.tsx",
    "primitive": "writeContractAsync",
    "functionName": "openAscendingDirect",
    "capability": "ascending_open_direct"
  },
  {
    "file": "components/claims/profile-claims-tab.tsx",
    "primitive": "runTx(",
    "functionName": null,
    "capability": "ascending_withdraw_claim"
  },
  {
    "file": "components/claims/profile-claims-tab.tsx",
    "primitive": "runTx(",
    "functionName": null,
    "capability": "fixed_price_withdraw_claim"
  },
  {
    "file": "components/claims/profile-claims-tab.tsx",
    "primitive": "runTx(",
    "functionName": null,
    "capability": "passport_withdraw_claim"
  },
  {
    "file": "components/claims/profile-claims-tab.tsx",
    "primitive": "runTx(",
    "functionName": null,
    "capability": "staking_withdraw_claim"
  },
  {
    "file": "components/claims/profile-claims-tab.tsx",
    "primitive": "writeContractAsync",
    "functionName": "withdrawClaim",
    "capability": "ascending_withdraw_claim"
  },
  {
    "file": "components/claims/profile-claims-tab.tsx",
    "primitive": "writeContractAsync",
    "functionName": "withdrawClaim",
    "capability": "fixed_price_withdraw_claim"
  },
  {
    "file": "components/claims/profile-claims-tab.tsx",
    "primitive": "writeContractAsync",
    "functionName": "withdrawClaim",
    "capability": "passport_withdraw_claim"
  },
  {
    "file": "components/claims/profile-claims-tab.tsx",
    "primitive": "writeContractAsync",
    "functionName": "withdrawClaim",
    "capability": "staking_withdraw_claim"
  },
  {
    "file": "components/commerce/agent-lower-commission-panel.tsx",
    "primitive": "requireEvmSession",
    "functionName": null,
    "capability": "ascending_lower_commission"
  },
  {
    "file": "components/commerce/agent-lower-commission-panel.tsx",
    "primitive": "requireEvmSession",
    "functionName": null,
    "capability": "fixed_price_lower_commission"
  },
  {
    "file": "components/commerce/agent-lower-commission-panel.tsx",
    "primitive": "runTx(",
    "functionName": null,
    "capability": "ascending_lower_commission"
  },
  {
    "file": "components/commerce/agent-lower-commission-panel.tsx",
    "primitive": "runTx(",
    "functionName": null,
    "capability": "fixed_price_lower_commission"
  },
  {
    "file": "components/commerce/agent-lower-commission-panel.tsx",
    "primitive": "writeContractAsync",
    "functionName": "lowerCommission",
    "capability": "ascending_lower_commission"
  },
  {
    "file": "components/commerce/agent-lower-commission-panel.tsx",
    "primitive": "writeContractAsync",
    "functionName": "lowerCommission",
    "capability": "fixed_price_lower_commission"
  },
  {
    "file": "components/commerce/commerce-pause-ops-row.tsx",
    "primitive": "runTx(",
    "functionName": null,
    "capability": "ascending_pause"
  },
  {
    "file": "components/commerce/commerce-pause-ops-row.tsx",
    "primitive": "runTx(",
    "functionName": null,
    "capability": "fixed_price_pause"
  },
  {
    "file": "components/commerce/commerce-pause-ops-row.tsx",
    "primitive": "writeContractAsync",
    "functionName": "pause",
    "capability": "ascending_pause"
  },
  {
    "file": "components/commerce/commerce-pause-ops-row.tsx",
    "primitive": "writeContractAsync",
    "functionName": "pause",
    "capability": "fixed_price_pause"
  },
  {
    "file": "components/commerce/commerce-revoke-token-row.tsx",
    "primitive": "runTx(",
    "functionName": null,
    "capability": "ascending_revoke_payment_token"
  },
  {
    "file": "components/commerce/commerce-revoke-token-row.tsx",
    "primitive": "runTx(",
    "functionName": null,
    "capability": "fixed_price_revoke_payment_token"
  },
  {
    "file": "components/commerce/commerce-revoke-token-row.tsx",
    "primitive": "writeContractAsync",
    "functionName": "revokePaymentToken",
    "capability": "ascending_revoke_payment_token"
  },
  {
    "file": "components/commerce/commerce-revoke-token-row.tsx",
    "primitive": "writeContractAsync",
    "functionName": "revokePaymentToken",
    "capability": "fixed_price_revoke_payment_token"
  },
  {
    "file": "components/commerce/owner-lower-floor-panel.tsx",
    "primitive": "requireEvmSession",
    "functionName": null,
    "capability": "ascending_lower_floor"
  },
  {
    "file": "components/commerce/owner-lower-floor-panel.tsx",
    "primitive": "requireEvmSession",
    "functionName": null,
    "capability": "fixed_price_lower_floor"
  },
  {
    "file": "components/commerce/owner-lower-floor-panel.tsx",
    "primitive": "runTx(",
    "functionName": null,
    "capability": "ascending_lower_floor"
  },
  {
    "file": "components/commerce/owner-lower-floor-panel.tsx",
    "primitive": "runTx(",
    "functionName": null,
    "capability": "fixed_price_lower_floor"
  },
  {
    "file": "components/commerce/owner-lower-floor-panel.tsx",
    "primitive": "writeContractAsync",
    "functionName": "lowerFloor",
    "capability": "ascending_lower_floor"
  },
  {
    "file": "components/commerce/owner-lower-floor-panel.tsx",
    "primitive": "writeContractAsync",
    "functionName": "lowerFloor",
    "capability": "fixed_price_lower_floor"
  },
  {
    "file": "components/commerce/owner-recall-panel.tsx",
    "primitive": "requireEvmSession",
    "functionName": null,
    "capability": "ascending_force_recall"
  },
  {
    "file": "components/commerce/owner-recall-panel.tsx",
    "primitive": "requireEvmSession",
    "functionName": null,
    "capability": "ascending_request_recall"
  },
  {
    "file": "components/commerce/owner-recall-panel.tsx",
    "primitive": "requireEvmSession",
    "functionName": null,
    "capability": "fixed_price_force_recall"
  },
  {
    "file": "components/commerce/owner-recall-panel.tsx",
    "primitive": "requireEvmSession",
    "functionName": null,
    "capability": "fixed_price_request_recall"
  },
  {
    "file": "components/commerce/owner-recall-panel.tsx",
    "primitive": "runTx(",
    "functionName": null,
    "capability": "ascending_force_recall"
  },
  {
    "file": "components/commerce/owner-recall-panel.tsx",
    "primitive": "runTx(",
    "functionName": null,
    "capability": "ascending_request_recall"
  },
  {
    "file": "components/commerce/owner-recall-panel.tsx",
    "primitive": "runTx(",
    "functionName": null,
    "capability": "fixed_price_force_recall"
  },
  {
    "file": "components/commerce/owner-recall-panel.tsx",
    "primitive": "runTx(",
    "functionName": null,
    "capability": "fixed_price_request_recall"
  },
  {
    "file": "components/commerce/owner-recall-panel.tsx",
    "primitive": "useReadContract",
    "functionName": "recallCooldown",
    "capability": "ascending_recall_cooldown"
  },
  {
    "file": "components/commerce/owner-recall-panel.tsx",
    "primitive": "useReadContract",
    "functionName": "recallCooldown",
    "capability": "fixed_price_recall_cooldown"
  },
  {
    "file": "components/commerce/owner-recall-panel.tsx",
    "primitive": "writeContractAsync",
    "functionName": "forceRecall",
    "capability": "ascending_force_recall"
  },
  {
    "file": "components/commerce/owner-recall-panel.tsx",
    "primitive": "writeContractAsync",
    "functionName": "forceRecall",
    "capability": "fixed_price_force_recall"
  },
  {
    "file": "components/commerce/owner-recall-panel.tsx",
    "primitive": "writeContractAsync",
    "functionName": "requestRecall",
    "capability": "ascending_request_recall"
  },
  {
    "file": "components/commerce/owner-recall-panel.tsx",
    "primitive": "writeContractAsync",
    "functionName": "requestRecall",
    "capability": "fixed_price_request_recall"
  },
  {
    "file": "components/marketplace/agent-authorization-status.tsx",
    "primitive": "requireEvmSession",
    "functionName": null,
    "capability": "fixed_price_revoke_mandate"
  },
  {
    "file": "components/marketplace/agent-authorization-status.tsx",
    "primitive": "runTx(",
    "functionName": null,
    "capability": "fixed_price_revoke_mandate"
  },
  {
    "file": "components/marketplace/agent-authorization-status.tsx",
    "primitive": "writeContractAsync",
    "functionName": "revoke",
    "capability": "fixed_price_revoke_mandate"
  },
  {
    "file": "components/marketplace/agent-delist-button.tsx",
    "primitive": "requireEvmSession",
    "functionName": null,
    "capability": "fixed_price_owner_withdraw"
  },
  {
    "file": "components/marketplace/agent-delist-button.tsx",
    "primitive": "runTx(",
    "functionName": null,
    "capability": "fixed_price_owner_withdraw"
  },
  {
    "file": "components/marketplace/agent-delist-button.tsx",
    "primitive": "writeContractAsync",
    "functionName": "agentWithdraw",
    "capability": "fixed_price_owner_withdraw"
  },
  {
    "file": "components/marketplace/agent-list-on-behalf-panel.tsx",
    "primitive": "requireEvmSession",
    "functionName": null,
    "capability": "fixed_price_open_direct"
  },
  {
    "file": "components/marketplace/agent-list-on-behalf-panel.tsx",
    "primitive": "requireEvmSession",
    "functionName": null,
    "capability": "fixed_price_set_settlement_note"
  },
  {
    "file": "components/marketplace/agent-list-on-behalf-panel.tsx",
    "primitive": "runTx(",
    "functionName": null,
    "capability": "fixed_price_open_direct"
  },
  {
    "file": "components/marketplace/agent-list-on-behalf-panel.tsx",
    "primitive": "runTx(",
    "functionName": null,
    "capability": "fixed_price_set_settlement_note"
  },
  {
    "file": "components/marketplace/agent-list-on-behalf-panel.tsx",
    "primitive": "writeContractAsync",
    "functionName": "openFromMandate",
    "capability": "fixed_price_open_direct"
  },
  {
    "file": "components/marketplace/agent-list-on-behalf-panel.tsx",
    "primitive": "writeContractAsync",
    "functionName": "setSettlementNote",
    "capability": "fixed_price_set_settlement_note"
  },
  {
    "file": "components/marketplace/agent-update-listing-panel.tsx",
    "primitive": "requireEvmSession",
    "functionName": null,
    "capability": "fixed_price_set_price"
  },
  {
    "file": "components/marketplace/agent-update-listing-panel.tsx",
    "primitive": "runTx(",
    "functionName": null,
    "capability": "fixed_price_set_price"
  },
  {
    "file": "components/marketplace/agent-update-listing-panel.tsx",
    "primitive": "useReadContract",
    "functionName": "settlementNotes",
    "capability": "settlement_notes"
  },
  {
    "file": "components/marketplace/agent-update-listing-panel.tsx",
    "primitive": "writeContractAsync",
    "functionName": "setPrice",
    "capability": "fixed_price_set_price"
  },
  {
    "file": "components/marketplace/authorize-agent-dialog.tsx",
    "primitive": "requireEvmSession",
    "functionName": null,
    "capability": "fixed_price_grant_mandate"
  },
  {
    "file": "components/marketplace/authorize-agent-dialog.tsx",
    "primitive": "runTx(",
    "functionName": null,
    "capability": "fixed_price_grant_mandate"
  },
  {
    "file": "components/marketplace/authorize-agent-dialog.tsx",
    "primitive": "writeContractAsync",
    "functionName": "grant",
    "capability": "fixed_price_grant_mandate"
  },
  {
    "file": "components/marketplace/listing-buy-panel.tsx",
    "primitive": "awaitReceipt(",
    "functionName": null,
    "capability": "erc20_approve"
  },
  {
    "file": "components/marketplace/listing-buy-panel.tsx",
    "primitive": "awaitReceipt(",
    "functionName": null,
    "capability": "fixed_price_buy"
  },
  {
    "file": "components/marketplace/listing-buy-panel.tsx",
    "primitive": "requireEvmSession",
    "functionName": null,
    "capability": "erc20_approve"
  },
  {
    "file": "components/marketplace/listing-buy-panel.tsx",
    "primitive": "requireEvmSession",
    "functionName": null,
    "capability": "fixed_price_buy"
  },
  {
    "file": "components/marketplace/listing-buy-panel.tsx",
    "primitive": "runTx(",
    "functionName": null,
    "capability": "erc20_approve"
  },
  {
    "file": "components/marketplace/listing-buy-panel.tsx",
    "primitive": "runTx(",
    "functionName": null,
    "capability": "fixed_price_buy"
  },
  {
    "file": "components/marketplace/listing-buy-panel.tsx",
    "primitive": "useBalance",
    "functionName": null,
    "capability": "native_balance"
  },
  {
    "file": "components/marketplace/listing-buy-panel.tsx",
    "primitive": "useReadContract",
    "functionName": "allowance",
    "capability": "fixed_price_buy"
  },
  {
    "file": "components/marketplace/listing-buy-panel.tsx",
    "primitive": "useReadContract",
    "functionName": "balanceOf",
    "capability": "erc20_balance"
  },
  {
    "file": "components/marketplace/listing-buy-panel.tsx",
    "primitive": "useReadContract",
    "functionName": "settlementNotes",
    "capability": "settlement_notes"
  },
  {
    "file": "components/marketplace/listing-buy-panel.tsx",
    "primitive": "writeContractAsync",
    "functionName": "approve",
    "capability": "erc20_approve"
  },
  {
    "file": "components/marketplace/listing-buy-panel.tsx",
    "primitive": "writeContractAsync",
    "functionName": "buy",
    "capability": "fixed_price_buy"
  },
  {
    "file": "components/marketplace/listing-detail-client-island.tsx",
    "primitive": "useReadContract",
    "functionName": "decimals",
    "capability": "spl_mint_decimals"
  },
  {
    "file": "components/marketplace/listing-edit-client.tsx",
    "primitive": "awaitReceipt(",
    "functionName": null,
    "capability": "fixed_price_owner_withdraw"
  },
  {
    "file": "components/marketplace/listing-edit-client.tsx",
    "primitive": "awaitReceipt(",
    "functionName": null,
    "capability": "fixed_price_set_price"
  },
  {
    "file": "components/marketplace/listing-edit-client.tsx",
    "primitive": "awaitReceipt(",
    "functionName": null,
    "capability": "fixed_price_set_settlement_note"
  },
  {
    "file": "components/marketplace/listing-edit-client.tsx",
    "primitive": "txWriteAvailability",
    "functionName": null,
    "capability": "fixed_price_owner_withdraw"
  },
  {
    "file": "components/marketplace/listing-edit-client.tsx",
    "primitive": "txWriteAvailability",
    "functionName": null,
    "capability": "fixed_price_set_price"
  },
  {
    "file": "components/marketplace/listing-edit-client.tsx",
    "primitive": "txWriteAvailability",
    "functionName": null,
    "capability": "fixed_price_set_settlement_note"
  },
  {
    "file": "components/marketplace/listing-edit-client.tsx",
    "primitive": "runTx(",
    "functionName": null,
    "capability": "fixed_price_owner_withdraw"
  },
  {
    "file": "components/marketplace/listing-edit-client.tsx",
    "primitive": "runTx(",
    "functionName": null,
    "capability": "fixed_price_set_price"
  },
  {
    "file": "components/marketplace/listing-edit-client.tsx",
    "primitive": "runTx(",
    "functionName": null,
    "capability": "fixed_price_set_settlement_note"
  },
  {
    "file": "components/marketplace/listing-edit-client.tsx",
    "primitive": "writeContractAsync",
    "functionName": "ownerWithdraw",
    "capability": "fixed_price_owner_withdraw"
  },
  {
    "file": "components/marketplace/listing-edit-client.tsx",
    "primitive": "writeContractAsync",
    "functionName": "setPrice",
    "capability": "fixed_price_set_price"
  },
  {
    "file": "components/marketplace/listing-edit-client.tsx",
    "primitive": "writeContractAsync",
    "functionName": "setSettlementNote",
    "capability": "fixed_price_set_settlement_note"
  },
  {
    "file": "components/marketplace/listing-offers-panel.tsx",
    "primitive": "requireEvmSession",
    "functionName": null,
    "capability": "fixed_price_confirm_external_payment"
  },
  {
    "file": "components/marketplace/listing-offers-panel.tsx",
    "primitive": "runTx(",
    "functionName": null,
    "capability": "fixed_price_confirm_external_payment"
  },
  {
    "file": "components/marketplace/listing-offers-panel.tsx",
    "primitive": "writeContractAsync",
    "functionName": "confirmExternalPayment",
    "capability": "fixed_price_confirm_external_payment"
  },
  {
    "file": "components/passport/create-passport-wizard.tsx",
    "primitive": "runTx(",
    "functionName": null,
    "capability": "create_passport"
  },
  {
    "file": "components/passport/create-passport-wizard.tsx",
    "primitive": "useSignMessage",
    "functionName": null,
    "capability": "create_passport"
  },
  {
    "file": "components/passport/create-passport-wizard.tsx",
    "primitive": "writeContractAsync",
    "functionName": "mintPassport",
    "capability": "create_passport"
  },
  {
    "file": "components/passport/passport-bridge-panel.tsx",
    "primitive": "useReadContract",
    "functionName": "ownerOf",
    "capability": "passport_owner"
  },
  {
    "file": "components/passport/passport-sell-panel.tsx",
    "primitive": "useReadContract",
    "functionName": "isActiveVerifier",
    "capability": "active_verifier"
  },
  {
    "file": "components/passport/passport-sell-panel.tsx",
    "primitive": "useReadContract",
    "functionName": "ownerOf",
    "capability": "passport_owner"
  },
  {
    "file": "components/profile/consigned-vehicles-tab.tsx",
    "primitive": "useReadContract",
    "functionName": "platformFeeBps",
    "capability": "fixed_price_platform_fee_bps"
  },
  {
    "file": "components/profile/delegated-vehicles-tab.tsx",
    "primitive": "useReadContract",
    "functionName": "decimals",
    "capability": "spl_mint_decimals"
  },
  {
    "file": "components/profile/profile-edit-client.tsx",
    "primitive": "useReadContract",
    "functionName": "isActiveVerifier",
    "capability": "active_verifier"
  },
  {
    "file": "components/verifier/verification-payment-modal.tsx",
    "primitive": "requireEvmSession",
    "functionName": null,
    "capability": "pay_verification_fee"
  },
  {
    "file": "components/verifier/verification-payment-modal.tsx",
    "primitive": "runTx(",
    "functionName": null,
    "capability": "pay_verification_fee"
  },
  {
    "file": "components/verifier/verification-payment-modal.tsx",
    "primitive": "useBalance",
    "functionName": null,
    "capability": "native_balance"
  },
  {
    "file": "components/verifier/verification-payment-modal.tsx",
    "primitive": "useReadContract",
    "functionName": "balanceOf",
    "capability": "erc20_balance"
  },
  {
    "file": "components/verifier/verification-payment-modal.tsx",
    "primitive": "useReadContract",
    "functionName": "verificationFee",
    "capability": "verification_fee"
  },
  {
    "file": "components/verifier/verification-payment-modal.tsx",
    "primitive": "writeContractAsync",
    "functionName": "transfer",
    "capability": "pay_verification_fee"
  },
  {
    "file": "hooks/use-ascending-auction-rules.ts",
    "primitive": "useReadContract",
    "functionName": "auctionRules",
    "capability": "auction_rules"
  },
  {
    "file": "hooks/use-auction-chain-reads.ts",
    "primitive": "useKeyedReadContracts",
    "functionName": "auctionDuration",
    "capability": "auction_rules"
  },
  {
    "file": "hooks/use-auction-chain-reads.ts",
    "primitive": "useKeyedReadContracts",
    "functionName": "auctionEndsAt",
    "capability": "auction_rules"
  },
  {
    "file": "hooks/use-auction-chain-reads.ts",
    "primitive": "useKeyedReadContracts",
    "functionName": "auctionExtensionWindow",
    "capability": "auction_rules"
  },
  {
    "file": "hooks/use-auction-chain-reads.ts",
    "primitive": "useKeyedReadContracts",
    "functionName": "auctionHighestBid",
    "capability": "auction_rules"
  },
  {
    "file": "hooks/use-auction-chain-reads.ts",
    "primitive": "useKeyedReadContracts",
    "functionName": "auctionHighestBidder",
    "capability": "auction_rules"
  },
  {
    "file": "hooks/use-auction-chain-reads.ts",
    "primitive": "useKeyedReadContracts",
    "functionName": "auctionMinIncrementBps",
    "capability": "auction_rules"
  },
  {
    "file": "hooks/use-auction-chain-reads.ts",
    "primitive": "useKeyedReadContracts",
    "functionName": "auctionProtectionWindow",
    "capability": "hold_protection_ends_at"
  },
  {
    "file": "hooks/use-auction-chain-reads.ts",
    "primitive": "useKeyedReadContracts",
    "functionName": "challengeBondAmount",
    "capability": "challenge_bond_amount"
  },
  {
    "file": "hooks/use-auction-chain-reads.ts",
    "primitive": "useKeyedReadContracts",
    "functionName": "challengeChallenger",
    "capability": "has_unresolved_settlement"
  },
  {
    "file": "hooks/use-auction-chain-reads.ts",
    "primitive": "useKeyedReadContracts",
    "functionName": "challengeOpenedAt",
    "capability": "challenge_open"
  },
  {
    "file": "hooks/use-auction-chain-reads.ts",
    "primitive": "useKeyedReadContracts",
    "functionName": "challengeWindowDuration",
    "capability": "has_unresolved_settlement"
  },
  {
    "file": "hooks/use-auction-chain-reads.ts",
    "primitive": "useKeyedReadContracts",
    "functionName": "consignmentAgentOf",
    "capability": "ascending_consignment_phase"
  },
  {
    "file": "hooks/use-auction-chain-reads.ts",
    "primitive": "useKeyedReadContracts",
    "functionName": "consignmentCommissionBpsOf",
    "capability": "ascending_consignment_phase"
  },
  {
    "file": "hooks/use-auction-chain-reads.ts",
    "primitive": "useKeyedReadContracts",
    "functionName": "consignmentCompensationFormOf",
    "capability": "ascending_consignment_phase"
  },
  {
    "file": "hooks/use-auction-chain-reads.ts",
    "primitive": "useKeyedReadContracts",
    "functionName": "consignmentFloorOf",
    "capability": "ascending_consignment_phase"
  },
  {
    "file": "hooks/use-auction-chain-reads.ts",
    "primitive": "useKeyedReadContracts",
    "functionName": "consignmentOpenedAt",
    "capability": "auction_rules"
  },
  {
    "file": "hooks/use-auction-chain-reads.ts",
    "primitive": "useKeyedReadContracts",
    "functionName": "consignmentPhase",
    "capability": "ascending_consignment_phase"
  },
  {
    "file": "hooks/use-auction-chain-reads.ts",
    "primitive": "useKeyedReadContracts",
    "functionName": "consignmentPriceOf",
    "capability": "ascending_consignment_phase"
  },
  {
    "file": "hooks/use-auction-chain-reads.ts",
    "primitive": "useKeyedReadContracts",
    "functionName": "consignmentSellerOf",
    "capability": "ascending_consignment_phase"
  },
  {
    "file": "hooks/use-auction-chain-reads.ts",
    "primitive": "useKeyedReadContracts",
    "functionName": "holdAbandonmentDeadline",
    "capability": "hold_protection_ends_at"
  },
  {
    "file": "hooks/use-auction-chain-reads.ts",
    "primitive": "useKeyedReadContracts",
    "functionName": "holdBuyer",
    "capability": "hold_protection_ends_at"
  },
  {
    "file": "hooks/use-auction-chain-reads.ts",
    "primitive": "useKeyedReadContracts",
    "functionName": "holdFrozenRemaining",
    "capability": "hold_protection_ends_at"
  },
  {
    "file": "hooks/use-auction-chain-reads.ts",
    "primitive": "useKeyedReadContracts",
    "functionName": "holdGross",
    "capability": "hold_protection_ends_at"
  },
  {
    "file": "hooks/use-auction-chain-reads.ts",
    "primitive": "useKeyedReadContracts",
    "functionName": "holdProtectionEndsAt",
    "capability": "hold_protection_ends_at"
  },
  {
    "file": "hooks/use-auction-chain-reads.ts",
    "primitive": "useKeyedReadContracts",
    "functionName": "holdReversalPending",
    "capability": "hold_protection_ends_at"
  },
  {
    "file": "hooks/use-auction-chain-reads.ts",
    "primitive": "useKeyedReadContracts",
    "functionName": "isBinding",
    "capability": "ascending_consignment_phase"
  },
  {
    "file": "hooks/use-auction-chain-reads.ts",
    "primitive": "useKeyedReadContracts",
    "functionName": "mandateAsset",
    "capability": "mandate_snapshot"
  },
  {
    "file": "hooks/use-auction-chain-reads.ts",
    "primitive": "useKeyedReadContracts",
    "functionName": "ownerOf",
    "capability": "passport_owner"
  },
  {
    "file": "hooks/use-auction-chain-reads.ts",
    "primitive": "useKeyedReadContracts",
    "functionName": "paused",
    "capability": "ascending_paused"
  },
  {
    "file": "hooks/use-auction-chain-reads.ts",
    "primitive": "useKeyedReadContracts",
    "functionName": "recallRequestTimestamp",
    "capability": "ascending_consignment_phase"
  },
  {
    "file": "hooks/use-auction-chain-reads.ts",
    "primitive": "useKeyedReadContracts",
    "functionName": "windowDuration",
    "capability": "auction_rules"
  },
  {
    "file": "hooks/use-bridge.ts",
    "primitive": "awaitReceipt(",
    "functionName": null,
    "capability": "bridge_send"
  },
  {
    "file": "hooks/use-bridge.ts",
    "primitive": "requireEvmSession",
    "functionName": null,
    "capability": "bridge_send"
  },
  {
    "file": "hooks/use-bridge.ts",
    "primitive": "runTx(",
    "functionName": null,
    "capability": "bridge_send"
  },
  {
    "file": "hooks/use-bridge.ts",
    "primitive": "usePublicClient",
    "functionName": null,
    "capability": "bridge_send"
  },
  {
    "file": "hooks/use-bridge.ts",
    "primitive": "writeContractAsync",
    "functionName": "send",
    "capability": "bridge_send"
  },
  {
    "file": "hooks/use-commerce-mode-paused.ts",
    "primitive": "useReadContract",
    "functionName": "paused",
    "capability": "ascending_paused"
  },
  {
    "file": "hooks/use-commerce-mode-paused.ts",
    "primitive": "useReadContract",
    "functionName": "paused",
    "capability": "fixed_price_paused"
  },
  {
    "file": "hooks/use-commerce-pause-ops.ts",
    "primitive": "useKeyedReadContracts",
    "functionName": "guardian",
    "capability": "ascending_guardian"
  },
  {
    "file": "hooks/use-commerce-pause-ops.ts",
    "primitive": "useKeyedReadContracts",
    "functionName": "guardian",
    "capability": "fixed_price_guardian"
  },
  {
    "file": "hooks/use-commerce-pause-ops.ts",
    "primitive": "useKeyedReadContracts",
    "functionName": "owner",
    "capability": "ascending_guardian"
  },
  {
    "file": "hooks/use-commerce-pause-ops.ts",
    "primitive": "useKeyedReadContracts",
    "functionName": "owner",
    "capability": "fixed_price_guardian"
  },
  {
    "file": "hooks/use-commerce-pause-ops.ts",
    "primitive": "useKeyedReadContracts",
    "functionName": "paused",
    "capability": "ascending_paused"
  },
  {
    "file": "hooks/use-commerce-pause-ops.ts",
    "primitive": "useKeyedReadContracts",
    "functionName": "paused",
    "capability": "fixed_price_paused"
  },
  {
    "file": "hooks/use-commerce-revoke-ops.ts",
    "primitive": "useKeyedReadContracts",
    "functionName": "paymentTokenEnabled",
    "capability": "ascending_payment_token_enabled"
  },
  {
    "file": "hooks/use-is-commerce-guardian.ts",
    "primitive": "useKeyedReadContracts",
    "functionName": "guardian",
    "capability": "ascending_guardian"
  },
  {
    "file": "hooks/use-is-commerce-guardian.ts",
    "primitive": "useKeyedReadContracts",
    "functionName": "guardian",
    "capability": "fixed_price_guardian"
  },
  {
    "file": "hooks/use-listing-chain-reads.ts",
    "primitive": "useKeyedReadContracts",
    "functionName": "consignmentAgentOf",
    "capability": "fixed_price_consignment_phase"
  },
  {
    "file": "hooks/use-listing-chain-reads.ts",
    "primitive": "useKeyedReadContracts",
    "functionName": "consignmentAssetOf",
    "capability": "listing_quote_buy"
  },
  {
    "file": "hooks/use-listing-chain-reads.ts",
    "primitive": "useKeyedReadContracts",
    "functionName": "consignmentCommissionBpsOf",
    "capability": "fixed_price_consignment_phase"
  },
  {
    "file": "hooks/use-listing-chain-reads.ts",
    "primitive": "useKeyedReadContracts",
    "functionName": "consignmentCompensationFormOf",
    "capability": "fixed_price_consignment_phase"
  },
  {
    "file": "hooks/use-listing-chain-reads.ts",
    "primitive": "useKeyedReadContracts",
    "functionName": "consignmentDenominationOf",
    "capability": "fixed_price_consignment_phase"
  },
  {
    "file": "hooks/use-listing-chain-reads.ts",
    "primitive": "useKeyedReadContracts",
    "functionName": "consignmentFloorOf",
    "capability": "fixed_price_consignment_phase"
  },
  {
    "file": "hooks/use-listing-chain-reads.ts",
    "primitive": "useKeyedReadContracts",
    "functionName": "consignmentPhase",
    "capability": "fixed_price_consignment_phase"
  },
  {
    "file": "hooks/use-listing-chain-reads.ts",
    "primitive": "useKeyedReadContracts",
    "functionName": "consignmentPriceOf",
    "capability": "fixed_price_consignment_phase"
  },
  {
    "file": "hooks/use-listing-chain-reads.ts",
    "primitive": "useKeyedReadContracts",
    "functionName": "consignmentSellerOf",
    "capability": "fixed_price_consignment_phase"
  },
  {
    "file": "hooks/use-listing-chain-reads.ts",
    "primitive": "useKeyedReadContracts",
    "functionName": "paused",
    "capability": "fixed_price_paused"
  },
  {
    "file": "hooks/use-listing-chain-reads.ts",
    "primitive": "useKeyedReadContracts",
    "functionName": "recallRequestTimestamp",
    "capability": "fixed_price_consignment_phase"
  },
  {
    "file": "hooks/use-listing-chain-reads.ts",
    "primitive": "useKeyedReadContracts",
    "functionName": "settlementNotes",
    "capability": "settlement_notes"
  },
  {
    "file": "hooks/use-mandate.ts",
    "primitive": "useKeyedReadContracts",
    "functionName": "mandateActive",
    "capability": "mandate_snapshot"
  },
  {
    "file": "hooks/use-mandate.ts",
    "primitive": "useKeyedReadContracts",
    "functionName": "mandateAgent",
    "capability": "mandate_snapshot"
  },
  {
    "file": "hooks/use-mandate.ts",
    "primitive": "useKeyedReadContracts",
    "functionName": "mandateAsset",
    "capability": "mandate_snapshot"
  },
  {
    "file": "hooks/use-mandate.ts",
    "primitive": "useKeyedReadContracts",
    "functionName": "mandateCommissionBps",
    "capability": "mandate_snapshot"
  },
  {
    "file": "hooks/use-mandate.ts",
    "primitive": "useKeyedReadContracts",
    "functionName": "mandateCompensationForm",
    "capability": "mandate_snapshot"
  },
  {
    "file": "hooks/use-mandate.ts",
    "primitive": "useKeyedReadContracts",
    "functionName": "mandateCurrencyCode",
    "capability": "mandate_snapshot"
  },
  {
    "file": "hooks/use-mandate.ts",
    "primitive": "useKeyedReadContracts",
    "functionName": "mandateDenominationKind",
    "capability": "mandate_snapshot"
  },
  {
    "file": "hooks/use-mandate.ts",
    "primitive": "useKeyedReadContracts",
    "functionName": "mandateExpiry",
    "capability": "mandate_snapshot"
  },
  {
    "file": "hooks/use-mandate.ts",
    "primitive": "useKeyedReadContracts",
    "functionName": "mandateFloor",
    "capability": "mandate_snapshot"
  },
  {
    "file": "hooks/use-mandate.ts",
    "primitive": "useKeyedReadContracts",
    "functionName": "platformFeeBps",
    "capability": "ascending_platform_fee_bps"
  },
  {
    "file": "hooks/use-mandate.ts",
    "primitive": "useKeyedReadContracts",
    "functionName": "platformFeeBps",
    "capability": "fixed_price_platform_fee_bps"
  },
  {
    "file": "hooks/use-min-stake-native.ts",
    "primitive": "useReadContract",
    "functionName": "minStakeNative",
    "capability": "active_verifier"
  },
  {
    "file": "hooks/use-passport-approval.ts",
    "primitive": "awaitReceipt(",
    "functionName": null,
    "capability": "passport_approve"
  },
  {
    "file": "hooks/use-passport-approval.ts",
    "primitive": "awaitReceipt(",
    "functionName": null,
    "capability": "passport_set_approval_for_all"
  },
  {
    "file": "hooks/use-passport-approval.ts",
    "primitive": "requireEvmSession",
    "functionName": null,
    "capability": "passport_approve"
  },
  {
    "file": "hooks/use-passport-approval.ts",
    "primitive": "requireEvmSession",
    "functionName": null,
    "capability": "passport_set_approval_for_all"
  },
  {
    "file": "hooks/use-passport-approval.ts",
    "primitive": "useKeyedReadContracts",
    "functionName": "getApproved",
    "capability": "passport_approval_state"
  },
  {
    "file": "hooks/use-passport-approval.ts",
    "primitive": "useKeyedReadContracts",
    "functionName": "isApprovedForAll",
    "capability": "passport_approval_state"
  },
  {
    "file": "hooks/use-passport-approval.ts",
    "primitive": "writeContractAsync",
    "functionName": "approve",
    "capability": "passport_approve"
  },
  {
    "file": "hooks/use-passport-approval.ts",
    "primitive": "writeContractAsync",
    "functionName": "setApprovalForAll",
    "capability": "passport_set_approval_for_all"
  },
  {
    "file": "hooks/use-passport-chain-status.ts",
    "primitive": "useReadContract",
    "functionName": "getPassportStatus",
    "capability": "passport_status"
  },
  {
    "file": "hooks/use-passport-on-chain-owner.ts",
    "primitive": "useReadContract",
    "functionName": "ownerOf",
    "capability": "passport_owner"
  },
  {
    "file": "hooks/use-peer-identity.ts",
    "primitive": "useReadContract",
    "functionName": "isActiveVerifier",
    "capability": "active_verifier"
  },
  {
    "file": "hooks/use-show-become-karpro.ts",
    "primitive": "useReadContract",
    "functionName": "isActiveVerifier",
    "capability": "active_verifier"
  },
  {
    "file": "lib/passport/append-passport-attestation.ts",
    "primitive": "txWriteAvailability",
    "functionName": null,
    "capability": "append_passport_attestation"
  },
  {
    "file": "lib/passport/append-passport-record.ts",
    "primitive": "txWriteAvailability",
    "functionName": null,
    "capability": "append_passport_record"
  },
  {
    "file": "lib/passport/conclude-challenge.ts",
    "primitive": "txWriteAvailability",
    "functionName": null,
    "capability": "conclude_challenge"
  },
  {
    "file": "lib/passport/judge-challenge.ts",
    "primitive": "txWriteAvailability",
    "functionName": null,
    "capability": "judge_challenge"
  },
  {
    "file": "lib/passport/open-challenge.ts",
    "primitive": "txWriteAvailability",
    "functionName": null,
    "capability": "open_challenge"
  },
  {
    "file": "lib/passport/prepare-passport-edit-write.ts",
    "primitive": "requireEvmSession",
    "functionName": null,
    "capability": "set_passport_uri"
  },
  {
    "file": "lib/passport/prepare-passport-edit-write.ts",
    "primitive": "txWriteAvailability",
    "functionName": null,
    "capability": "set_passport_uri"
  },
  {
    "file": "lib/passport/prepare-passport-record-write.ts",
    "primitive": "requireEvmSession",
    "functionName": null,
    "capability": "append_passport_record"
  },
  {
    "file": "lib/passport/prepare-passport-record-write.ts",
    "primitive": "txWriteAvailability",
    "functionName": null,
    "capability": "append_passport_record"
  },
  {
    "file": "lib/passport/report-passport-discrepancy.ts",
    "primitive": "txWriteAvailability",
    "functionName": null,
    "capability": "report_passport_discrepancy"
  },
  {
    "file": "lib/passport/set-passport-uri.ts",
    "primitive": "txWriteAvailability",
    "functionName": null,
    "capability": "set_passport_uri"
  },
  {
    "file": "lib/passport/verify-passport.ts",
    "primitive": "txWriteAvailability",
    "functionName": null,
    "capability": "verify_passport"
  },
  {
    "file": "lib/passport/withdraw-challenge.ts",
    "primitive": "txWriteAvailability",
    "functionName": null,
    "capability": "withdraw_challenge"
  },
  {
    "file": "lib/commerce/open-fixed-price-consignment.ts",
    "primitive": "txWriteAvailability",
    "functionName": null,
    "capability": "fixed_price_open_direct"
  }
];

export const SURFACE_CENSUS_CAPABILITY_META: SurfaceCensusCapabilityMeta[] = [
  {
    "id": "set_passport_uri",
    "kind": "write_action",
    "evmSource": "see consuming files",
    "evidence": null,
    "svmReader": "present",
    "observedSvmBehaviour": "known"
  },
  {
    "id": "append_passport_record",
    "kind": "write_action",
    "evmSource": "see consuming files",
    "evidence": null,
    "svmReader": "present",
    "observedSvmBehaviour": "known"
  },
  {
    "id": "report_passport_discrepancy",
    "kind": "write_action",
    "evmSource": "see consuming files",
    "evidence": null,
    "svmReader": "present",
    "observedSvmBehaviour": "known"
  },
  {
    "id": "append_passport_attestation",
    "kind": "write_action",
    "evmSource": "see consuming files",
    "evidence": null,
    "svmReader": "present",
    "observedSvmBehaviour": "known"
  },
  {
    "id": "verify_passport",
    "kind": "write_action",
    "evmSource": "see consuming files",
    "evidence": null,
    "svmReader": "present",
    "observedSvmBehaviour": "known"
  },
  {
    "id": "open_challenge",
    "kind": "write_action",
    "evmSource": "see consuming files",
    "evidence": null,
    "svmReader": "present",
    "observedSvmBehaviour": "known"
  },
  {
    "id": "withdraw_challenge",
    "kind": "write_action",
    "evmSource": "see consuming files",
    "evidence": null,
    "svmReader": "present",
    "observedSvmBehaviour": "known"
  },
  {
    "id": "judge_challenge",
    "kind": "write_action",
    "evmSource": "see consuming files",
    "evidence": null,
    "svmReader": "present",
    "observedSvmBehaviour": "known"
  },
  {
    "id": "conclude_challenge",
    "kind": "write_action",
    "evmSource": "see consuming files",
    "evidence": null,
    "svmReader": "present",
    "observedSvmBehaviour": "known"
  },
  {
    "id": "ascending_open_challenge",
    "kind": "write_action",
    "evmSource": "see consuming files",
    "evidence": null,
    "svmReader": "owed",
    "observedSvmBehaviour": "known"
  },
  {
    "id": "ascending_withdraw_challenge",
    "kind": "write_action",
    "evmSource": "see consuming files",
    "evidence": null,
    "svmReader": "owed",
    "observedSvmBehaviour": "known"
  },
  {
    "id": "ascending_judge_challenge",
    "kind": "write_action",
    "evmSource": "see consuming files",
    "evidence": null,
    "svmReader": "owed",
    "observedSvmBehaviour": "known"
  },
  {
    "id": "ascending_conclude_challenge",
    "kind": "write_action",
    "evmSource": "see consuming files",
    "evidence": null,
    "svmReader": "owed",
    "observedSvmBehaviour": "known"
  },
  {
    "id": "set_verification_fee",
    "kind": "write_action",
    "evmSource": "see consuming files",
    "evidence": null,
    "svmReader": "present",
    "observedSvmBehaviour": "known"
  },
  {
    "id": "create_passport",
    "kind": "write_action",
    "evmSource": "see consuming files",
    "evidence": null,
    "svmReader": "owed",
    "observedSvmBehaviour": "known"
  },
  {
    "id": "custody_locked",
    "kind": "read_fact",
    "evmSource": "see consuming files",
    "evidence": {
      "source": "state",
      "item": "PassportState.custody_locked"
    },
    "svmReader": "present",
    "observedSvmBehaviour": "invented_value"
  },
  {
    "id": "may_open_consignment",
    "kind": "read_fact",
    "evmSource": "see consuming files",
    "evidence": {
      "source": "struct_field",
      "item": "EncumbranceAnswer.allowed"
    },
    "svmReader": "present",
    "observedSvmBehaviour": "known"
  },
  {
    "id": "may_leave_chain",
    "kind": "read_fact",
    "evmSource": "see consuming files",
    "evidence": {
      "source": "struct_field",
      "item": "EncumbranceAnswer.allowed"
    },
    "svmReader": "present",
    "observedSvmBehaviour": "known"
  },
  {
    "id": "encumbrance_registry",
    "kind": "read_fact",
    "evmSource": "see consuming files",
    "evidence": {
      "source": "struct_field",
      "item": "PassportConfig.encumbrance_sources"
    },
    "svmReader": "present",
    "observedSvmBehaviour": "known"
  },
  {
    "id": "challenge_bond_amount",
    "kind": "read_fact",
    "evmSource": "see consuming files",
    "evidence": {
      "source": "state",
      "item": "PassportConfig.dispute_deposit"
    },
    "svmReader": "present",
    "observedSvmBehaviour": "known"
  },
  {
    "id": "verification_fee",
    "kind": "read_fact",
    "evmSource": "see consuming files",
    "evidence": {
      "source": "state",
      "item": "StakeAccount.verification_fee"
    },
    "svmReader": "owed",
    "observedSvmBehaviour": "known"
  },
  {
    "id": "active_verifier",
    "kind": "read_fact",
    "evmSource": "see consuming files",
    "evidence": {
      "source": "state",
      "item": "StakeAccount.active"
    },
    "svmReader": "present",
    "observedSvmBehaviour": "known"
  },
  {
    "id": "passport_owner",
    "kind": "read_fact",
    "evmSource": "see consuming files",
    "evidence": {
      "source": "foreign_field",
      "item": {
        "program": "mpl_core",
        "type": "BaseAssetV1",
        "field": "owner"
      }
    },
    "svmReader": "owed",
    "observedSvmBehaviour": "silent_undefined"
  },
  {
    "id": "passport_status",
    "kind": "read_fact",
    "evmSource": "see consuming files",
    "evidence": {
      "source": "state",
      "item": "PassportState.status"
    },
    "svmReader": "owed",
    "observedSvmBehaviour": "silent_undefined"
  },
  {
    "id": "dispute_window",
    "kind": "read_fact",
    "evmSource": "see consuming files",
    "evidence": {
      "source": "const",
      "item": "DISPUTE_WINDOW_SECONDS"
    },
    "svmReader": "owed",
    "observedSvmBehaviour": "known"
  },
  {
    "id": "settlement_notes",
    "kind": "read_fact",
    "evmSource": "see consuming files",
    "evidence": {
      "source": "struct_field",
      "item": "SettlementNoteRecord.note_len"
    },
    "svmReader": "owed",
    "observedSvmBehaviour": "known"
  },
  {
    "id": "hold_protection_ends_at",
    "kind": "read_fact",
    "evmSource": "see consuming files",
    "evidence": {
      "source": "struct_field",
      "item": "HoldRecord.protection_ends_at"
    },
    "svmReader": "owed",
    "observedSvmBehaviour": "known"
  },
  {
    "id": "has_unresolved_settlement",
    "kind": "read_fact",
    "evmSource": "see consuming files",
    "evidence": {
      "source": "struct_field",
      "item": "HoldRecord.reversal_pending"
    },
    "svmReader": "owed",
    "observedSvmBehaviour": "known"
  },
  {
    "id": "challenge_open",
    "kind": "read_fact",
    "evmSource": "see consuming files",
    "evidence": {
      "source": "state",
      "item": "ChallengeAccount.opened_at"
    },
    "svmReader": "present",
    "observedSvmBehaviour": "silent_undefined"
  },
  {
    "id": "passport_approve",
    "kind": "write_action",
    "evmSource": "see consuming files",
    "evidence": null,
    "svmReader": "owed",
    "observedSvmBehaviour": "false_family_sentence"
  },
  {
    "id": "passport_approval_state",
    "kind": "read_fact",
    "evmSource": "see consuming files",
    "evidence": {
      "source": "foreign_field",
      "item": {
        "program": "mpl_core",
        "type": "Asset",
        "field": "transfer_delegate"
      }
    },
    "svmReader": "owed",
    "observedSvmBehaviour": "hidden"
  },
  {
    "id": "passport_set_approval_for_all",
    "kind": "write_action",
    "evmSource": "see consuming files",
    "evidence": null,
    "svmReader": null,
    "observedSvmBehaviour": "hidden"
  },
  {
    "id": "bridge_send",
    "kind": "write_action",
    "evmSource": "see consuming files",
    "evidence": null,
    "svmReader": "owed",
    "observedSvmBehaviour": "false_family_sentence"
  },
  {
    "id": "fixed_price_open_direct",
    "kind": "write_action",
    "evmSource": "see consuming files",
    "evidence": null,
    "svmReader": "present",
    "observedSvmBehaviour": "known"
  },
  {
    "id": "fixed_price_set_price",
    "kind": "write_action",
    "evmSource": "see consuming files",
    "evidence": null,
    "svmReader": "owed",
    "observedSvmBehaviour": "known"
  },
  {
    "id": "fixed_price_set_settlement_note",
    "kind": "write_action",
    "evmSource": "see consuming files",
    "evidence": null,
    "svmReader": "owed",
    "observedSvmBehaviour": "known"
  },
  {
    "id": "fixed_price_buy",
    "kind": "write_action",
    "evmSource": "see consuming files",
    "evidence": null,
    "svmReader": "owed",
    "observedSvmBehaviour": "false_family_sentence"
  },
  {
    "id": "fixed_price_owner_withdraw",
    "kind": "write_action",
    "evmSource": "see consuming files",
    "evidence": null,
    "svmReader": "owed",
    "observedSvmBehaviour": "known"
  },
  {
    "id": "fixed_price_confirm_external_payment",
    "kind": "write_action",
    "evmSource": "see consuming files",
    "evidence": null,
    "svmReader": "owed",
    "observedSvmBehaviour": "known"
  },
  {
    "id": "fixed_price_grant_mandate",
    "kind": "write_action",
    "evmSource": "see consuming files",
    "evidence": null,
    "svmReader": "owed",
    "observedSvmBehaviour": "known"
  },
  {
    "id": "fixed_price_revoke_mandate",
    "kind": "write_action",
    "evmSource": "see consuming files",
    "evidence": null,
    "svmReader": "owed",
    "observedSvmBehaviour": "known"
  },
  {
    "id": "fixed_price_lower_floor",
    "kind": "write_action",
    "evmSource": "see consuming files",
    "evidence": null,
    "svmReader": "owed",
    "observedSvmBehaviour": "known"
  },
  {
    "id": "fixed_price_lower_commission",
    "kind": "write_action",
    "evmSource": "see consuming files",
    "evidence": null,
    "svmReader": "owed",
    "observedSvmBehaviour": "known"
  },
  {
    "id": "fixed_price_request_recall",
    "kind": "write_action",
    "evmSource": "see consuming files",
    "evidence": null,
    "svmReader": "owed",
    "observedSvmBehaviour": "known"
  },
  {
    "id": "fixed_price_force_recall",
    "kind": "write_action",
    "evmSource": "see consuming files",
    "evidence": null,
    "svmReader": "owed",
    "observedSvmBehaviour": "known"
  },
  {
    "id": "fixed_price_pause",
    "kind": "write_action",
    "evmSource": "see consuming files",
    "evidence": null,
    "svmReader": "owed",
    "observedSvmBehaviour": "known"
  },
  {
    "id": "fixed_price_revoke_payment_token",
    "kind": "write_action",
    "evmSource": "see consuming files",
    "evidence": null,
    "svmReader": "owed",
    "observedSvmBehaviour": "known"
  },
  {
    "id": "fixed_price_withdraw_claim",
    "kind": "write_action",
    "evmSource": "see consuming files",
    "evidence": null,
    "svmReader": "owed",
    "observedSvmBehaviour": "known"
  },
  {
    "id": "ascending_open_direct",
    "kind": "write_action",
    "evmSource": "see consuming files",
    "evidence": null,
    "svmReader": "owed",
    "observedSvmBehaviour": "known"
  },
  {
    "id": "ascending_bid",
    "kind": "write_action",
    "evmSource": "see consuming files",
    "evidence": null,
    "svmReader": "owed",
    "observedSvmBehaviour": "false_family_sentence"
  },
  {
    "id": "ascending_cancel",
    "kind": "write_action",
    "evmSource": "see consuming files",
    "evidence": null,
    "svmReader": null,
    "observedSvmBehaviour": "hidden"
  },
  {
    "id": "ascending_settle",
    "kind": "write_action",
    "evmSource": "see consuming files",
    "evidence": null,
    "svmReader": "owed",
    "observedSvmBehaviour": "known"
  },
  {
    "id": "ascending_complete_reversal",
    "kind": "write_action",
    "evmSource": "see consuming files",
    "evidence": null,
    "svmReader": "owed",
    "observedSvmBehaviour": "known"
  },
  {
    "id": "ascending_grant_mandate",
    "kind": "write_action",
    "evmSource": "see consuming files",
    "evidence": null,
    "svmReader": "owed",
    "observedSvmBehaviour": "known"
  },
  {
    "id": "ascending_revoke_mandate",
    "kind": "write_action",
    "evmSource": "see consuming files",
    "evidence": null,
    "svmReader": "owed",
    "observedSvmBehaviour": "known"
  },
  {
    "id": "ascending_lower_floor",
    "kind": "write_action",
    "evmSource": "see consuming files",
    "evidence": null,
    "svmReader": null,
    "observedSvmBehaviour": "known"
  },
  {
    "id": "ascending_lower_commission",
    "kind": "write_action",
    "evmSource": "see consuming files",
    "evidence": null,
    "svmReader": null,
    "observedSvmBehaviour": "known"
  },
  {
    "id": "ascending_request_recall",
    "kind": "write_action",
    "evmSource": "see consuming files",
    "evidence": null,
    "svmReader": null,
    "observedSvmBehaviour": "known"
  },
  {
    "id": "ascending_force_recall",
    "kind": "write_action",
    "evmSource": "see consuming files",
    "evidence": null,
    "svmReader": null,
    "observedSvmBehaviour": "known"
  },
  {
    "id": "ascending_pause",
    "kind": "write_action",
    "evmSource": "see consuming files",
    "evidence": null,
    "svmReader": "owed",
    "observedSvmBehaviour": "known"
  },
  {
    "id": "ascending_revoke_payment_token",
    "kind": "write_action",
    "evmSource": "see consuming files",
    "evidence": null,
    "svmReader": "owed",
    "observedSvmBehaviour": "known"
  },
  {
    "id": "ascending_withdraw_claim",
    "kind": "write_action",
    "evmSource": "see consuming files",
    "evidence": null,
    "svmReader": "owed",
    "observedSvmBehaviour": "known"
  },
  {
    "id": "ascending_confirm_receipt",
    "kind": "write_action",
    "evmSource": "see consuming files",
    "evidence": null,
    "svmReader": "owed",
    "observedSvmBehaviour": "known"
  },
  {
    "id": "ascending_release_funds",
    "kind": "write_action",
    "evmSource": "see consuming files",
    "evidence": null,
    "svmReader": "owed",
    "observedSvmBehaviour": "known"
  },
  {
    "id": "ascending_abandon_reversal",
    "kind": "write_action",
    "evmSource": "see consuming files",
    "evidence": null,
    "svmReader": "owed",
    "observedSvmBehaviour": "known"
  },
  {
    "id": "pay_verification_fee",
    "kind": "write_action",
    "evmSource": "see consuming files",
    "evidence": {
      "source": "chain",
      "item": [
        "native_transfer",
        "spl_transfer"
      ]
    },
    "svmReader": "owed",
    "observedSvmBehaviour": "known"
  },
  {
    "id": "kar_pro_join",
    "kind": "write_action",
    "evmSource": "see consuming files",
    "evidence": null,
    "svmReader": "owed",
    "observedSvmBehaviour": "known"
  },
  {
    "id": "kar_pro_leave",
    "kind": "write_action",
    "evmSource": "see consuming files",
    "evidence": null,
    "svmReader": "owed",
    "observedSvmBehaviour": "known"
  },
  {
    "id": "passport_withdraw_claim",
    "kind": "write_action",
    "evmSource": "see consuming files",
    "evidence": null,
    "svmReader": "owed",
    "observedSvmBehaviour": "known"
  },
  {
    "id": "staking_withdraw_claim",
    "kind": "write_action",
    "evmSource": "see consuming files",
    "evidence": null,
    "svmReader": null,
    "observedSvmBehaviour": "known"
  },
  {
    "id": "listing_quote_buy",
    "kind": "read_fact",
    "evmSource": "see consuming files",
    "evidence": {
      "source": "struct_field",
      "item": "ConsignmentRecord.price"
    },
    "svmReader": "owed",
    "observedSvmBehaviour": "known"
  },
  {
    "id": "fixed_price_consignment_phase",
    "kind": "read_fact",
    "evmSource": "see consuming files",
    "evidence": {
      "source": "struct_field",
      "item": "ConsignmentRecord.phase"
    },
    "svmReader": "present",
    "observedSvmBehaviour": "known"
  },
  {
    "id": "ascending_consignment_phase",
    "kind": "read_fact",
    "evmSource": "see consuming files",
    "evidence": {
      "source": "struct_field",
      "item": "ConsignmentRecord.phase"
    },
    "svmReader": "present",
    "observedSvmBehaviour": "known"
  },
  {
    "id": "auction_rules",
    "kind": "read_fact",
    "evmSource": "see consuming files",
    "evidence": {
      "source": "struct_field",
      "item": "AuctionTermsRecord.protection_window"
    },
    "svmReader": "owed",
    "observedSvmBehaviour": "known"
  },
  {
    "id": "mandate_snapshot",
    "kind": "read_fact",
    "evmSource": "see consuming files",
    "evidence": {
      "source": "struct_field",
      "item": "MandateRecord.agent"
    },
    "svmReader": "present",
    "observedSvmBehaviour": "known"
  },
  {
    "id": "fixed_price_paused",
    "kind": "read_fact",
    "evmSource": "see consuming files",
    "evidence": {
      "source": "struct_field",
      "item": "CommerceConfig.paused"
    },
    "svmReader": "owed",
    "observedSvmBehaviour": "known"
  },
  {
    "id": "ascending_paused",
    "kind": "read_fact",
    "evmSource": "see consuming files",
    "evidence": {
      "source": "struct_field",
      "item": "AscendingConfig.paused"
    },
    "svmReader": "owed",
    "observedSvmBehaviour": "known"
  },
  {
    "id": "fixed_price_platform_fee_bps",
    "kind": "read_fact",
    "evmSource": "see consuming files",
    "evidence": {
      "source": "struct_field",
      "item": "CommerceConfig.platform_fee_bps"
    },
    "svmReader": "owed",
    "observedSvmBehaviour": "known"
  },
  {
    "id": "ascending_platform_fee_bps",
    "kind": "read_fact",
    "evmSource": "see consuming files",
    "evidence": {
      "source": "struct_field",
      "item": "AscendingConfig.platform_fee_bps"
    },
    "svmReader": "owed",
    "observedSvmBehaviour": "known"
  },
  {
    "id": "fixed_price_guardian",
    "kind": "read_fact",
    "evmSource": "see consuming files",
    "evidence": {
      "source": "struct_field",
      "item": "CommerceConfig.guardian"
    },
    "svmReader": "owed",
    "observedSvmBehaviour": "known"
  },
  {
    "id": "ascending_guardian",
    "kind": "read_fact",
    "evmSource": "see consuming files",
    "evidence": {
      "source": "struct_field",
      "item": "AscendingConfig.guardian"
    },
    "svmReader": "owed",
    "observedSvmBehaviour": "known"
  },
  {
    "id": "fixed_price_payment_tokens",
    "kind": "read_fact",
    "evmSource": "see consuming files",
    "evidence": {
      "source": "struct_field",
      "item": "PaymentTokenRecord.enabled"
    },
    "svmReader": "owed",
    "observedSvmBehaviour": "known"
  },
  {
    "id": "ascending_payment_token_enabled",
    "kind": "read_fact",
    "evmSource": "see consuming files",
    "evidence": {
      "source": "struct_field",
      "item": "PaymentTokenRecord.enabled"
    },
    "svmReader": "owed",
    "observedSvmBehaviour": "known"
  },
  {
    "id": "fixed_price_recall_cooldown",
    "kind": "read_fact",
    "evmSource": "see consuming files",
    "evidence": {
      "source": "const",
      "item": "RECALL_COOLDOWN_SECS"
    },
    "svmReader": "owed",
    "observedSvmBehaviour": "known"
  },
  {
    "id": "ascending_recall_cooldown",
    "kind": "read_fact",
    "evmSource": "see consuming files",
    "evidence": null,
    "svmReader": null,
    "observedSvmBehaviour": "known"
  },
  {
    "id": "erc20_balance",
    "kind": "read_fact",
    "evmSource": "see consuming files",
    "evidence": {
      "source": "chain",
      "item": "spl_token_account_amount"
    },
    "svmReader": "owed",
    "observedSvmBehaviour": "known"
  },
  {
    "id": "erc20_approve",
    "kind": "write_action",
    "evmSource": "see consuming files",
    "evidence": null,
    "svmReader": "owed",
    "observedSvmBehaviour": "known"
  },
  {
    "id": "native_balance",
    "kind": "read_fact",
    "evmSource": "see consuming files",
    "evidence": {
      "source": "chain",
      "item": "lamports"
    },
    "svmReader": "owed",
    "observedSvmBehaviour": "known"
  },
  {
    "id": "spl_mint_decimals",
    "kind": "read_fact",
    "evmSource": "see consuming files",
    "evidence": {
      "source": "chain",
      "item": "spl_mint_decimals"
    },
    "svmReader": "owed",
    "observedSvmBehaviour": "known"
  },
  {
    "id": "fiat_price_feed",
    "kind": "read_fact",
    "evmSource": "see consuming files",
    "evidence": {
      "source": "const",
      "item": "PRICE_UPDATE_V2_LEN"
    },
    "svmReader": "owed",
    "observedSvmBehaviour": "known"
  },
  {
    "id": "claim_asset_meta",
    "kind": "read_fact",
    "evmSource": "see consuming files",
    "evidence": {
      "source": "struct_field",
      "item": "PaymentTokenRecord.decimals"
    },
    "svmReader": "owed",
    "observedSvmBehaviour": "known"
  },
  {
    "id": "nostr_identity",
    "kind": "write_action",
    "evmSource": "see consuming files",
    "evidence": null,
    "svmReader": "owed",
    "observedSvmBehaviour": "known"
  },
  {
    "id": "messaging_session",
    "kind": "read_fact",
    "evmSource": "see consuming files",
    "evidence": null,
    "svmReader": "owed",
    "observedSvmBehaviour": "known"
  },
  {
    "id": "nwc_lightning",
    "kind": "read_fact",
    "evmSource": "see consuming files",
    "evidence": null,
    "svmReader": "owed",
    "observedSvmBehaviour": "known"
  },
  {
    "id": "ens_profile",
    "kind": "read_fact",
    "evmSource": "see consuming files",
    "evidence": null,
    "svmReader": "owed",
    "observedSvmBehaviour": "known"
  }
];

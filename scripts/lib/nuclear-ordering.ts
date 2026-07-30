/**
 * Nuclear #2 ordering invariants — pure checks for plan + deploy scripts.
 *
 * Encumbrance registration must follow both mode proxies and precede gateway
 * bind / ownership handoff. A run that registers late fails here rather than
 * proceeding to a stack where `may` is blind to live consignments.
 */

import { NUCLEAR_DEPLOY_STEPS, type NuclearDeployStep } from "./nuclear-deploy-plan.js";

/** Steps that must complete before commerce is considered open-ready. */
export const NUCLEAR_ENCUMBRANCE_REGISTER_STEPS = [
  "addEncumbranceSourceFixedPrice",
  "addEncumbranceSourceAscending",
] as const satisfies readonly NuclearDeployStep[];

/**
 * Owner-gated ops that sit behind Timelock48h after Nuclear handoff.
 * Modes initialize with owner = timelock, so these never run as the deployer EOA.
 */
export const NUCLEAR_TIMELOCK_OWNER_OPS = [
  "FixedPrice.approvePaymentToken",
  "FixedPrice.revokePaymentToken",
  "FixedPrice.setCurrencyFeed",
  "FixedPrice.setMaxFeedStaleness",
  "FixedPrice.setGuardian",
  "FixedPrice.unpause",
  "FixedPrice.upgradeToAndCall",
  "Ascending.approvePaymentToken",
  "Ascending.revokePaymentToken",
  "Ascending.setAuctionRules",
  "Ascending.setGuardian",
  "Ascending.unpause",
  "Ascending.upgradeToAndCall",
  "KarPassport.addEncumbranceSource",
  "KarPassport.removeEncumbranceSource",
  "KarPassport.setDisputeDeposit",
  "KarPassport.rescueExcessEth",
  "KarProStaking.setMinStakeNative",
  "KarProStaking.setStakeToken",
] as const;

export type NuclearTimelockOwnerOp = (typeof NUCLEAR_TIMELOCK_OWNER_OPS)[number];

/**
 * Fail if encumbrance registration is missing or out of order relative to
 * mode proxies and gateway bind.
 */
export function assertNuclearEncumbranceOrdering(
  steps: readonly string[] = NUCLEAR_DEPLOY_STEPS,
): void {
  const idx = (name: string) => {
    const i = steps.indexOf(name);
    if (i < 0) throw new Error(`Nuclear steps missing required step: ${name}`);
    return i;
  };

  const ascendingProxy = idx("AscendingConsignmentProxy");
  const regFixed = idx("addEncumbranceSourceFixedPrice");
  const regAscending = idx("addEncumbranceSourceAscending");
  const gateway = idx("KarPassportBridgeGateway");
  const setGateway = idx("setBridgeGateway");
  const handoffPassport = idx("transferPassportOwnership");

  if (!(ascendingProxy < regFixed && ascendingProxy < regAscending)) {
    throw new Error(
      "Nuclear ordering: both mode proxies must deploy before addEncumbranceSource",
    );
  }
  if (!(regFixed < gateway && regAscending < gateway)) {
    throw new Error(
      "Nuclear ordering: addEncumbranceSource must complete before KarPassportBridgeGateway",
    );
  }
  if (!(regFixed < setGateway && regAscending < setGateway)) {
    throw new Error(
      "Nuclear ordering: addEncumbranceSource must complete before setBridgeGateway",
    );
  }
  if (!(regFixed < handoffPassport && regAscending < handoffPassport)) {
    throw new Error(
      "Nuclear ordering: addEncumbranceSource must complete before passport ownership handoff",
    );
  }
}

/**
 * On-chain assertion after the register writes. Deploy scripts must call this
 * before deploying the gateway or transferring ownership.
 */
export function assertSourcesRegistered(input: {
  fixedPriceRegistered: boolean;
  ascendingRegistered: boolean;
  fixedPrice: string;
  ascending: string;
}): void {
  if (!input.fixedPriceRegistered) {
    throw new Error(
      `Encumbrance not registered for FixedPrice ${input.fixedPrice} — refusing to continue Nuclear sequence`,
    );
  }
  if (!input.ascendingRegistered) {
    throw new Error(
      `Encumbrance not registered for Ascending ${input.ascending} — refusing to continue Nuclear sequence`,
    );
  }
}

/**
 * Checklist-only constraint (cannot fail the script without a Solidity gate):
 * `openDirect` / `openAscending*` do not require `isEncumbranceSource(address(this))`.
 * An operator who skips registration can still open consignments while LeaveChain
 * stays blind. Nuclear runbook must not skip register; optional future bytecode
 * gate is a finding, not a silent assumption.
 */
export const CHECKLIST_ONCHAIN_OPEN_WITHOUT_REGISTER =
  "On-chain open does not require isEncumbranceSource(this). Register both modes before any consignment opens — enforced in deploy scripts, not bytecode.";

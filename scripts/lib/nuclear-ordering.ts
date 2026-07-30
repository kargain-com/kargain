/**
 * Nuclear #2 ordering invariants — pure checks for plan + deploy scripts.
 *
 * Encumbrance registration must follow both mode proxies and precede gateway
 * bind. Payment-token admission must complete while the deployer still owns the
 * modes, before Timelock handoff. A run that registers late or hands off before
 * admission fails here rather than proceeding.
 */

import { NUCLEAR_DEPLOY_STEPS, type NuclearDeployStep } from "./nuclear-deploy-plan.js";

/** Steps that must complete before commerce is considered open-ready. */
export const NUCLEAR_ENCUMBRANCE_REGISTER_STEPS = [
  "addEncumbranceSourceFixedPrice",
  "addEncumbranceSourceAscending",
] as const satisfies readonly NuclearDeployStep[];

/**
 * Guardian-immediate reduce-exposure ops (G3). Not delayed.
 * Owner (Timelock) may also revoke; guardian may not approve.
 */
export const NUCLEAR_GUARDIAN_IMMEDIATE_OPS = [
  "FixedPrice.pause",
  "FixedPrice.revokePaymentToken",
  "Ascending.pause",
  "Ascending.revokePaymentToken",
] as const;

/**
 * Owner-gated ops that sit behind Timelock48h after Nuclear handoff.
 * Initial payment-token admission runs as deployer before handoff; post-handoff
 * approve / feed changes go through Timelock.
 */
export const NUCLEAR_TIMELOCK_OWNER_OPS = [
  "FixedPrice.approvePaymentToken",
  "FixedPrice.setCurrencyFeed",
  "FixedPrice.setMaxFeedStaleness",
  "FixedPrice.setGuardian",
  "FixedPrice.unpause",
  "FixedPrice.upgradeToAndCall",
  "Ascending.approvePaymentToken",
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
 * Fail if encumbrance registration / admission / handoff are missing or out of order.
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
  const admitFixed = idx("approvePaymentTokenFixedPrice");
  const admitAscending = idx("approvePaymentTokenAscending");
  const gateway = idx("KarPassportBridgeGateway");
  const setGateway = idx("setBridgeGateway");
  const handoffFixed = idx("transferFixedPriceOwnership");
  const handoffAscending = idx("transferAscendingOwnership");
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
  if (!(admitFixed < handoffFixed && admitAscending < handoffAscending)) {
    throw new Error(
      "Nuclear ordering: approvePaymentToken must complete before mode ownership handoff",
    );
  }
  if (!(regFixed < handoffPassport && regAscending < handoffPassport)) {
    throw new Error(
      "Nuclear ordering: addEncumbranceSource must complete before passport ownership handoff",
    );
  }
  if (!(admitFixed < handoffPassport && admitAscending < handoffPassport)) {
    throw new Error(
      "Nuclear ordering: payment-token admission must complete before passport ownership handoff",
    );
  }
  if (!(handoffFixed < handoffPassport && handoffAscending < handoffPassport)) {
    throw new Error(
      "Nuclear ordering: mode ownership handoff must precede passport ownership handoff",
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
 * On-chain assertion after deployer admission. Must hold before mode handoff.
 */
export function assertPaymentTokensAdmitted(input: {
  fixedPriceUsdcEnabled: boolean;
  ascendingUsdcEnabled: boolean;
  usdc: string;
  /** FixedPrice payment-token feed; required non-zero for Nuclear USDC. */
  fixedPriceUsdcFeed?: string;
}): void {
  if (!input.fixedPriceUsdcEnabled) {
    throw new Error(
      `FixedPrice payment token not admitted for ${input.usdc} — refusing mode ownership handoff`,
    );
  }
  if (!input.ascendingUsdcEnabled) {
    throw new Error(
      `Ascending payment token not admitted for ${input.usdc} — refusing mode ownership handoff`,
    );
  }
  if (input.fixedPriceUsdcFeed !== undefined) {
    const zero = "0x0000000000000000000000000000000000000000";
    if (input.fixedPriceUsdcFeed.toLowerCase() === zero) {
      throw new Error(
        `FixedPrice USDC feed is zero for ${input.usdc} — refusing silent peg / mode ownership handoff`,
      );
    }
  }
}

/**
 * Bytecode open requires `isEncumbranceSource(this)` (ConsignmentBase._requireCanOpen).
 * Tooling register + on-chain gate are independent custody guards.
 */
export const ONCHAIN_OPEN_REQUIRES_ENCUMBRANCE_SOURCE =
  "On-chain open requires isEncumbranceSource(this) — ModeNotEncumbranceSource if unregistered. Deploy scripts also abort if register is missing before gateway.";

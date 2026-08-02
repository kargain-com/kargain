import { getAddress, isAddress, type Address } from "viem";

import {
  commerceModeLabel,
  type CommerceMode,
} from "@/lib/commerce/mode";

export type GuardianRevokeRole = "guardian" | "owner" | "other" | "disconnected";

export type RevokeTokenBlockCause =
  | "disconnected"
  | "not_guardian"
  | "token_not_enabled"
  | "reads_unresolved";

export type GuardianRevokeGate =
  | { readonly status: "available" }
  | { readonly status: "blocked"; readonly cause: RevokeTokenBlockCause };

export type GuardianRevokeControl = {
  readonly role: GuardianRevokeRole;
  readonly revoke: GuardianRevokeGate;
  /** Token already soft-revoked — restore is Timelock-only. */
  readonly showRestoreHint: boolean;
};

function sameAddress(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  if (!a || !b || !isAddress(a) || !isAddress(b)) return false;
  return getAddress(a) === getAddress(b);
}

export function normalizeRevokeAddress(
  value: string | null | undefined,
): Address | undefined {
  if (!value || !isAddress(value)) return undefined;
  return getAddress(value);
}

/**
 * Pure G3 soft-revoke control. Wallet CTA is guardian-only: after Nuclear,
 * `owner()` is Timelock48h — a connected EOA is never the owner. Timelock
 * revoke/restore stays schedule/execute (CLI), not MetaMask.
 *
 * Chain `enabled` owns CTA truth; Ponder only supplies candidate addresses.
 */
export function deriveGuardianRevokeControl(input: {
  connected: string | null | undefined;
  guardian: string | null | undefined;
  owner: string | null | undefined;
  /** Chain-sourced admission flag. `undefined` = unread. */
  enabled: boolean | undefined;
}): GuardianRevokeControl {
  const { connected, guardian, owner, enabled } = input;

  let role: GuardianRevokeRole = "disconnected";
  if (connected && isAddress(connected)) {
    if (sameAddress(connected, guardian)) role = "guardian";
    else if (sameAddress(connected, owner)) role = "owner";
    else role = "other";
  }

  if (enabled === undefined) {
    return {
      role,
      revoke: { status: "blocked", cause: "reads_unresolved" },
      showRestoreHint: false,
    };
  }

  if (enabled === false) {
    return {
      role,
      revoke: { status: "blocked", cause: "token_not_enabled" },
      showRestoreHint: true,
    };
  }

  if (role === "disconnected") {
    return {
      role,
      revoke: { status: "blocked", cause: "disconnected" },
      showRestoreHint: false,
    };
  }

  // Owner (timelock) match does not unlock the wallet CTA — same discipline as
  // pause ops. Solidity still allows owner via Timelock execute.
  if (role !== "guardian") {
    return {
      role,
      revoke: { status: "blocked", cause: "not_guardian" },
      showRestoreHint: false,
    };
  }

  return {
    role,
    revoke: { status: "available" },
    showRestoreHint: false,
  };
}

export function revokeBlockCauseCopy(cause: RevokeTokenBlockCause): string {
  switch (cause) {
    case "disconnected":
      return "Connect the guardian wallet to soft-revoke a payment token.";
    case "not_guardian":
      return "Only the mode guardian can soft-revoke from this page. The timelock owner restores admission through ops, not from a connected wallet.";
    case "token_not_enabled":
      return "This token is already soft-revoked. New opens in this asset are blocked; in-flight deals still settle.";
    case "reads_unresolved":
      return "Chain admission state is still loading. Soft-revoke is withheld until it resolves.";
    default: {
      const _exhaustive: never = cause;
      return _exhaustive;
    }
  }
}

export type RevokeConfirmCopy = {
  title: string;
  body: string;
};

/**
 * Confirmation before guardian soft-revoke — what stops vs what continues.
 */
export function revokePaymentTokenConfirmCopy(input: {
  mode: CommerceMode;
  chainLabel: string;
  tokenLabel: string;
}): RevokeConfirmCopy {
  const modeLabel = commerceModeLabel(input.mode);
  return {
    title: `Revoke ${input.tokenLabel} on ${modeLabel} (${input.chainLabel})?`,
    body:
      `New consignments denominated in this asset can no longer open on ${modeLabel}. ` +
      `Deals already in flight still settle. Restoring admission is a timelock owner procedure — ` +
      `there is no approve control on this page.`,
  };
}

/** Parallel to UNPAUSE_HINT — restore is Timelock approvePaymentToken. */
export const RESTORE_PAYMENT_TOKEN_HINT =
  "Restoring a payment token is an ops procedure for the timelock owner — there is no approve control here.";

import { getAddress, isAddress, type Address } from "viem";

import {
  commerceModeLabel,
  type CommerceMode,
} from "@/lib/commerce/mode";

export type GuardianPauseRole = "guardian" | "owner" | "other" | "disconnected";

export type GuardianPauseControl = {
  /** Offer the pause write only to the live guardian while running. */
  canPause: boolean;
  role: GuardianPauseRole;
  /** When paused, surface that unpause is a timelock/owner ops procedure. */
  showUnpauseHint: boolean;
};

function sameAddress(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  if (!a || !b || !isAddress(a) || !isAddress(b)) return false;
  return getAddress(a) === getAddress(b);
}

/**
 * Pure G3 pause control policy. Owner (timelock) never gets the pause CTA —
 * even when the same EOA is both owner and guardian the guardian branch wins
 * only via the guardian address match; owner-only match never unlocks pause.
 */
export function deriveGuardianPauseControl(input: {
  connected: string | null | undefined;
  guardian: string | null | undefined;
  owner: string | null | undefined;
  paused: boolean | undefined;
}): GuardianPauseControl {
  const { connected, guardian, owner, paused } = input;
  if (!connected || !isAddress(connected)) {
    return { canPause: false, role: "disconnected", showUnpauseHint: paused === true };
  }
  const isGuardian = sameAddress(connected, guardian);
  const isOwner = sameAddress(connected, owner);
  const role: GuardianPauseRole = isGuardian
    ? "guardian"
    : isOwner
      ? "owner"
      : "other";
  return {
    canPause: isGuardian && paused === false,
    role,
    showUnpauseHint: paused === true,
  };
}

/** Actions this mode refuses while paused (G3 / §13a.6). */
export function pauseBlockedActions(mode: CommerceMode): readonly string[] {
  switch (mode) {
    case "fixedPrice":
      return ["opening new consignments", "buying"];
    case "ascending":
      return ["opening new consignments", "bidding"];
    default: {
      const _exhaustive: never = mode;
      return _exhaustive;
    }
  }
}

export function formatPauseBlockedClause(mode: CommerceMode): string {
  const actions = pauseBlockedActions(mode);
  if (actions.length === 1) return actions[0]!;
  if (actions.length === 2) return `${actions[0]} and ${actions[1]}`;
  const head = actions.slice(0, -1).join(", ");
  return `${head}, and ${actions[actions.length - 1]}`;
}

export type PauseConfirmCopy = {
  title: string;
  body: string;
};

/**
 * Confirmation before a guardian pauses. States what stops and what continues —
 * the difference between a protection and a panic under pressure.
 */
export function pauseConfirmCopy(input: {
  mode: CommerceMode;
  chainLabel: string;
}): PauseConfirmCopy {
  const modeLabel = commerceModeLabel(input.mode);
  const stopped = formatPauseBlockedClause(input.mode);
  return {
    title: `Pause ${modeLabel} on ${input.chainLabel}?`,
    body:
      `This stops ${stopped} on this mode. Settlement, claims, withdrawals, recall, and challenges keep running. ` +
      `Unpausing is not available here — only the timelock owner can unpause.`,
  };
}

/** Canonical user-facing announcement when a mode is paused (chain-sourced). */
export const COMMERCE_PAUSED_ANNOUNCEMENT =
  "This mode is paused. Opening, bidding, and buying are unavailable until the timelock owner unpauses. Settlement, claims, and challenges are unaffected.";

/** Shorter panel line when the surface is buy-only or bid-only. */
export function commercePausedAnnouncementForMode(mode: CommerceMode): string {
  switch (mode) {
    case "fixedPrice":
      return "This mode is paused. Opening and buying are unavailable until the timelock owner unpauses. Settlement, claims, and challenges are unaffected.";
    case "ascending":
      return "This mode is paused. Opening and bidding are unavailable until the timelock owner unpauses. Settlement, claims, and challenges are unaffected.";
    default: {
      const _exhaustive: never = mode;
      return _exhaustive;
    }
  }
}

export const UNPAUSE_HINT =
  "Unpausing is an ops procedure for the timelock owner — there is no unpause control here.";

export function normalizeAddress(
  value: string | null | undefined,
): Address | undefined {
  if (!value || !isAddress(value)) return undefined;
  return getAddress(value);
}

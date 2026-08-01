import type { PassportStatus } from "@/lib/types/ponder";
import { shortChainName } from "@/lib/web3/supported-chains";

/**
 * Chain-relative answer: is the usable passport on the chain being viewed?
 * Distinct from escrow custody (selling mode holds the NFT) and from encumbrance/`may`.
 * Mirrors on-chain `custodyLocked` → `PassportBridgedAway`.
 */
export type PassportPresence =
  | { readonly status: "here" }
  | { readonly status: "away"; readonly locationChainId: number | null }
  | { readonly status: "unresolved" };

export type DerivePassportPresenceInput = {
  /** Chain the UI is viewing / acting on. */
  readonly viewChainId: number;
  /**
   * On-chain `custodyLocked(tokenId)` on `viewChainId`.
   * `undefined` = unread → fail closed.
   */
  readonly custodyLocked: boolean | undefined;
  /**
   * Ponder `custodyChain` when known — usable-copy location.
   * `undefined` does not invent location; lock alone still yields away.
   */
  readonly ponderCustodyChain?: number | undefined;
  /**
   * Optional location hint when away (counterpart / transit destination).
   * Used when ponder custody is unread or still equals the view chain during transit.
   */
  readonly locationChainId?: number | null;
};

export function derivePassportPresence(
  input: DerivePassportPresenceInput,
): PassportPresence {
  if (input.custodyLocked === undefined) {
    return { status: "unresolved" };
  }

  if (input.custodyLocked === true) {
    const fromPonder =
      input.ponderCustodyChain != null &&
      input.ponderCustodyChain !== input.viewChainId
        ? input.ponderCustodyChain
        : null;
    const locationChainId =
      fromPonder ??
      (input.locationChainId != null &&
      input.locationChainId !== input.viewChainId
        ? input.locationChainId
        : null);
    return { status: "away", locationChainId };
  }

  // Unlocked on this chain, but indexer says the usable copy lives elsewhere.
  if (
    input.ponderCustodyChain != null &&
    input.ponderCustodyChain !== input.viewChainId
  ) {
    return {
      status: "away",
      locationChainId: input.ponderCustodyChain,
    };
  }

  return { status: "here" };
}

export function isPassportHere(presence: PassportPresence): boolean {
  return presence.status === "here";
}

/** Writes must not be offered when away or unread. */
export function presenceBlocksWrites(presence: PassportPresence): boolean {
  return presence.status !== "here";
}

export function passportAwayActionCopy(presence: PassportPresence): string {
  if (presence.status === "unresolved") {
    return "Waiting for chain custody…";
  }
  if (presence.status !== "away") {
    return "";
  }
  if (presence.locationChainId != null) {
    return `This passport is on ${shortChainName(presence.locationChainId)}. Return it to this chain to restore this action.`;
  }
  return "This passport is on another chain. Return it here to restore this action.";
}

/**
 * Trust presentation for a recorded status given presence.
 * Away / unresolved never assert a live VERIFIED state.
 */
export type PassportTrustDisplay = {
  /** Status to show on a badge, or null when withheld. */
  readonly badgeStatus: PassportStatus | null;
  /** True only when VERIFIED is current on this chain. */
  readonly showVerifiedAccent: boolean;
  /** True when gallery / seal may use verified framing. */
  readonly showVerifiedFrame: boolean;
};

export function derivePassportTrustDisplay(
  presence: PassportPresence,
  recordedStatus: PassportStatus,
): PassportTrustDisplay {
  if (presence.status !== "here") {
    return {
      badgeStatus: null,
      showVerifiedAccent: false,
      showVerifiedFrame: false,
    };
  }
  return {
    badgeStatus: recordedStatus,
    showVerifiedAccent: recordedStatus === "VERIFIED",
    showVerifiedFrame: recordedStatus === "VERIFIED",
  };
}

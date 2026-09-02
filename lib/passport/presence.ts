import {
  type CustodyUnresolvedCause,
  parseCustodyUnresolvedCause,
} from "@/lib/custody/normalized-event";
import type { PassportStatus } from "@/lib/types/ponder";
import { shortChainName } from "@/lib/web3/supported-chains";

/**
 * Chain-relative answer: is the usable passport on the chain being viewed?
 * Distinct from escrow custody (selling mode holds the NFT) and from encumbrance/`may`.
 * Mirrors on-chain `custodyLocked` → `PassportBridgedAway`.
 *
 * Four states (§4.21) — unread chain read and incomplete fold are never collapsed.
 */
export type PassportPresence =
  | { readonly status: "here" }
  | { readonly status: "away"; readonly locationChainId: number | null }
  | { readonly status: "location_unread" }
  | {
      readonly status: "location_unresolved";
      readonly cause: CustodyUnresolvedCause;
    };

export type DerivePassportPresenceInput = {
  /** Chain the UI is viewing / acting on. */
  readonly viewChainId: number;
  /**
   * On-chain `custodyLocked(tokenId)` on `viewChainId`.
   * `undefined` = unread → `location_unread`.
   */
  readonly custodyLocked: boolean | undefined;
  /**
   * Ponder `custodyChain` when known — usable-copy location.
   * `undefined` does not invent location; lock alone still yields away.
   */
  readonly ponderCustodyChain?: number | null | undefined;
  /** Fold incomplete — `location_unresolved` with the named cause. */
  readonly custodyUnresolved?: string | null;
  /**
   * Optional location hint when away (counterpart / transit destination).
   * Used when ponder custody is unread or still equals the view chain during transit.
   */
  readonly locationChainId?: number | null;
};

const LOCATION_UNRESOLVED_CAUSE_LINE: Record<CustodyUnresolvedCause, string> = {
  empty_history: "No custody events are recorded for this passport yet.",
  departure_without_arrival:
    "This passport left its last network and its arrival has not been recorded yet.",
  incomplete_crossing_link:
    "A crossing for this passport is recorded on one side only.",
  unknown_namespace:
    "The last network recorded for this passport is not one Kargain serves.",
  conflicting_determination:
    "Two networks claim this passport at the same time.",
};

const LOCATION_UNRESOLVED_CONSEQUENCE =
  "Actions that depend on custody stay unavailable until the location resolves.";

const LOCATION_UNRESOLVED_UNKNOWN_NAMESPACE_CONSEQUENCE =
  "This passport cannot be acted on from Kargain while its location is outside the served networks.";

const LOCATION_UNREAD_COPY =
  "Waiting for the chain to answer where this passport is.";

/**
 * Sole chrome copy for a fold cause (§4.21). Exhaustive against
 * `CUSTODY_UNRESOLVED_CAUSES` — proven in `test/passport-presence.test.ts`.
 */
export function locationUnresolvedCauseCopy(
  cause: CustodyUnresolvedCause,
): string {
  const line = LOCATION_UNRESOLVED_CAUSE_LINE[cause];
  const consequence =
    cause === "unknown_namespace"
      ? LOCATION_UNRESOLVED_UNKNOWN_NAMESPACE_CONSEQUENCE
      : LOCATION_UNRESOLVED_CONSEQUENCE;
  return `${line} ${consequence}`;
}

/** Export for exhaustiveness tests — keys must match the runtime enumerator. */
export function locationUnresolvedCauseCopyTable(): Readonly<
  Record<CustodyUnresolvedCause, string>
> {
  return LOCATION_UNRESOLVED_CAUSE_LINE;
}

export function derivePassportPresence(
  input: DerivePassportPresenceInput,
): PassportPresence {
  const foldCause = parseCustodyUnresolvedCause(input.custodyUnresolved);
  if (foldCause != null) {
    return { status: "location_unresolved", cause: foldCause };
  }

  if (input.custodyLocked === undefined) {
    return { status: "location_unread" };
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

/** Writes must not be offered when away, unread, or fold-unresolved. */
export function presenceBlocksWrites(presence: PassportPresence): boolean {
  return presence.status !== "here";
}

/**
 * Factual body copy when presence blocks an action (§4.21).
 * Unread and unresolved never share a sentence.
 */
export function passportAwayActionCopy(presence: PassportPresence): string {
  if (presence.status === "location_unread") {
    return LOCATION_UNREAD_COPY;
  }
  if (presence.status === "location_unresolved") {
    return locationUnresolvedCauseCopy(presence.cause);
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
 * Away / location gaps never assert a live VERIFIED state.
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

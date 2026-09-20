import {
  type CustodyUnresolvedCause,
  parseCustodyUnresolvedCause,
} from "@/lib/custody/normalized-event";
import type { PassportStatus } from "@/lib/types/ponder";
import type { KeyedReadCause } from "@/lib/web3/keyed-multicall";
import { shortChainName } from "@/lib/web3/supported-chains";

/**
 * Chain-relative answer: is the usable passport on the chain being viewed?
 * Distinct from escrow custody (selling mode holds the NFT) and from encumbrance/`may`.
 * Mirrors on-chain `custodyLocked` → `PassportBridgedAway`.
 *
 * Five states (§4.21) — pending lock read, refused lock read, and incomplete fold
 * are never collapsed. A wait and a refusal never share a sentence.
 */
export type PassportPresence =
  | { readonly status: "here" }
  | { readonly status: "away"; readonly locationChainId: number | null }
  | { readonly status: "location_pending" }
  | {
      readonly status: "location_refused";
      readonly cause: KeyedReadCause;
    }
  | {
      readonly status: "location_unresolved";
      readonly cause: CustodyUnresolvedCause;
    };

/**
 * On-chain custody-lock read as a fact — known | pending | refused(cause).
 * Never invent unlocked (`known` + `locked: false`) from absence.
 */
export type CustodyLockRead =
  | { readonly status: "known"; readonly locked: boolean }
  | { readonly status: "pending" }
  | { readonly status: "refused"; readonly cause: KeyedReadCause };

export type DerivePassportPresenceInput = {
  /** Chain the UI is viewing / acting on. */
  readonly viewChainId: number;
  /**
   * On-chain `custodyLocked(tokenId)` on `viewChainId` as a typed fact.
   * Pending → `location_pending`; refused → `location_refused`.
   */
  readonly custodyLock: CustodyLockRead;
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

const LOCATION_PENDING_COPY =
  "Waiting for the chain to answer where this passport is.";

const LOCATION_REFUSED_CONSEQUENCE =
  "Actions that depend on custody stay unavailable until the location resolves.";

const LOCATION_REFUSED_CAUSE_LINE: Record<KeyedReadCause, string> = {
  rpc_unavailable: "The network did not answer where this passport is.",
  account_not_found:
    "The chain answered and this passport's lock account is not present.",
  malformed_response:
    "The chain answered with a lock read that could not be understood.",
  unresolved_namespace:
    "This network is not registered for lock reads in Kargain.",
  evm_call_failed: "The chain call for this passport's lock did not succeed.",
};

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

export function locationRefusedCauseCopy(cause: KeyedReadCause): string {
  return `${LOCATION_REFUSED_CAUSE_LINE[cause]} ${LOCATION_REFUSED_CONSEQUENCE}`;
}

export function derivePassportPresence(
  input: DerivePassportPresenceInput,
): PassportPresence {
  const foldCause = parseCustodyUnresolvedCause(input.custodyUnresolved);
  if (foldCause != null) {
    return { status: "location_unresolved", cause: foldCause };
  }

  const lock = input.custodyLock;
  if (lock.status === "pending") {
    return { status: "location_pending" };
  }
  if (lock.status === "refused") {
    return { status: "location_refused", cause: lock.cause };
  }

  if (lock.locked === true) {
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

/** Writes must not be offered when away, pending, refused, or fold-unresolved. */
export function presenceBlocksWrites(presence: PassportPresence): boolean {
  return presence.status !== "here";
}

/**
 * Factual body copy when presence blocks an action (§4.21).
 * Pending, refused, and unresolved never share a sentence.
 */
export function passportAwayActionCopy(presence: PassportPresence): string {
  if (presence.status === "location_pending") {
    return LOCATION_PENDING_COPY;
  }
  if (presence.status === "location_refused") {
    return locationRefusedCauseCopy(presence.cause);
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

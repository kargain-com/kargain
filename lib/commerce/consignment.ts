import type { CompensationForm, DenominationKind } from "@/lib/commerce/denomination";
import type { CommerceMode } from "@/lib/commerce/mode";

/** `ConsignmentBase.Phase`. */
export const CONSIGNMENT_PHASE = {
  None: 0,
  Offered: 1,
  Closed: 2,
  Returned: 3,
} as const;

export type ConsignmentPhase =
  (typeof CONSIGNMENT_PHASE)[keyof typeof CONSIGNMENT_PHASE];

/** `ConsignmentBase.CloseReason`. */
export const CLOSE_REASON = {
  Returned: 0,
  Sold: 1,
  ExternalConfirmed: 2,
  HoldReleased: 3,
  Recalled: 4,
  ReversalCompleted: 5,
  ReversalAbandoned: 6,
} as const;

export type CloseReason = (typeof CLOSE_REASON)[keyof typeof CLOSE_REASON];

/** `IKarPassportEncumbrance.Intent` — argument to `may(tokenId, intent)`. */
export const ENCUMBRANCE_INTENT = {
  LeaveChain: 0,
  OpenConsignment: 1,
} as const;

export type EncumbranceIntent =
  (typeof ENCUMBRANCE_INTENT)[keyof typeof ENCUMBRANCE_INTENT];

export function parseConsignmentPhase(
  raw: number | null | undefined,
): ConsignmentPhase | null {
  switch (raw) {
    case CONSIGNMENT_PHASE.None:
      return CONSIGNMENT_PHASE.None;
    case CONSIGNMENT_PHASE.Offered:
      return CONSIGNMENT_PHASE.Offered;
    case CONSIGNMENT_PHASE.Closed:
      return CONSIGNMENT_PHASE.Closed;
    case CONSIGNMENT_PHASE.Returned:
      return CONSIGNMENT_PHASE.Returned;
    default:
      return null;
  }
}

export function parseCloseReason(raw: number | null | undefined): CloseReason | null {
  if (raw == null || !Number.isInteger(raw)) return null;
  const values = Object.values(CLOSE_REASON) as number[];
  return values.includes(raw) ? (raw as CloseReason) : null;
}

export function closeReasonLabel(reason: CloseReason | null): string {
  switch (reason) {
    case CLOSE_REASON.Returned:
      return "Returned";
    case CLOSE_REASON.Sold:
      return "Sold";
    case CLOSE_REASON.ExternalConfirmed:
      return "Paid outside the app";
    case CLOSE_REASON.HoldReleased:
      return "Settled";
    case CLOSE_REASON.Recalled:
      return "Recalled";
    case CLOSE_REASON.ReversalCompleted:
      return "Reversed";
    case CLOSE_REASON.ReversalAbandoned:
      return "Reversal abandoned";
    default:
      return "Closed";
  }
}

/**
 * A consignment held by a mode contract. Built from the granular on-chain
 * getters (`consignment*Of`) — the storage struct itself is internal.
 */
export type ConsignmentSnapshot = {
  readonly mode: CommerceMode;
  readonly tokenId: string;
  readonly phase: ConsignmentPhase;
  readonly seller: `0x${string}`;
  /** Zero address when the seller opened directly (no mandate). */
  readonly agent: `0x${string}`;
  readonly floor: bigint;
  readonly price: bigint;
  readonly openedAt: number;
  readonly compensationForm: CompensationForm;
  readonly commissionBps: number;
  /** Fixed price only — payment asset (zero address = native). */
  readonly asset: `0x${string}` | null;
  /** Fixed price only — price denomination. */
  readonly denominationKind: DenominationKind | null;
  readonly currencyCode: `0x${string}` | null;
};

export const ZERO_ADDRESS: `0x${string}` = "0x0000000000000000000000000000000000000000";

export function isZeroAddress(value: string | null | undefined): boolean {
  return !value || value.toLowerCase() === ZERO_ADDRESS;
}

/** Live = accepting commerce. Only `Offered` blocks bridging and re-listing. */
export function isLiveConsignmentPhase(phase: ConsignmentPhase | null): boolean {
  return phase === CONSIGNMENT_PHASE.Offered;
}

export function isLiveConsignment(
  snapshot: ConsignmentSnapshot | null | undefined,
): boolean {
  return snapshot != null && isLiveConsignmentPhase(snapshot.phase);
}

export function consignmentHasAgent(
  snapshot: ConsignmentSnapshot | null | undefined,
): boolean {
  return snapshot != null && !isZeroAddress(snapshot.agent);
}

export function addressesMatch(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  if (!a || !b) return false;
  return a.toLowerCase() === b.toLowerCase();
}

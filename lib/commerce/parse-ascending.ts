import {
  type ConsignmentSnapshot,
  ZERO_ADDRESS,
  parseConsignmentPhase,
} from "@/lib/commerce/consignment";
import { COMPENSATION_FORM, parseCompensationForm } from "@/lib/commerce/denomination";

export type AscendingConsignmentReads = {
  readonly phase?: number;
  readonly seller?: string;
  readonly agent?: string;
  readonly floor?: bigint;
  readonly price?: bigint;
  readonly openedAt?: bigint | number;
  readonly compensationForm?: number;
  readonly commissionBps?: number;
};

/** Per-lot terms snapshotted at open (`AscendingTermsSnapshotted`). */
export type AscendingTermsSnapshot = {
  readonly duration: number;
  readonly endsAt: number;
  readonly extensionWindow: number;
  readonly protectionWindow: number;
  readonly abandonmentWindow: number;
  readonly minIncrementBps: number;
  readonly highestBidder: `0x${string}`;
  readonly highestBid: bigint;
};

export type AscendingTermsReads = {
  readonly duration?: bigint | number;
  readonly endsAt?: bigint | number;
  readonly extensionWindow?: bigint | number;
  readonly protectionWindow?: bigint | number;
  readonly abandonmentWindow?: bigint | number;
  readonly minIncrementBps?: number;
  readonly highestBidder?: string;
  readonly highestBid?: bigint;
};

/** Settlement hold created by `settle` and cleared by release/reversal. */
export type AscendingHoldSnapshot = {
  readonly buyer: `0x${string}`;
  readonly gross: bigint;
  readonly protectionEndsAt: number;
  readonly frozenRemaining: number;
  readonly reversalPending: boolean;
  readonly abandonmentDeadline: number;
  readonly abandonmentWindow: number;
};

export type AscendingHoldReads = {
  readonly buyer?: string;
  readonly gross?: bigint;
  readonly protectionEndsAt?: bigint | number;
  readonly frozenRemaining?: bigint | number;
  readonly reversalPending?: boolean;
  readonly abandonmentDeadline?: bigint | number;
  readonly abandonmentWindow?: bigint | number;
};

/** Global `auctionRules()` tuple. */
export type AuctionRules = {
  readonly minDuration: number;
  readonly maxDuration: number;
  readonly extensionWindow: number;
  readonly minIncrementBps: number;
  readonly protectionWindow: number;
  readonly abandonmentWindow: number;
  readonly challengeBond: bigint;
};

export type AuctionRulesTuple = readonly [
  minDuration: number,
  maxDuration: number,
  extensionWindow: number,
  minIncrementBps: number,
  protectionWindow: number,
  abandonmentWindow: number,
  challengeBond: bigint,
];

function toAddress(value: string | undefined): `0x${string}` {
  if (!value || !value.startsWith("0x")) return ZERO_ADDRESS;
  return value as `0x${string}`;
}

function toSeconds(value: bigint | number | undefined): number {
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return 0;
}

export function parseAscendingConsignment(
  tokenId: string,
  reads: AscendingConsignmentReads | null | undefined,
): ConsignmentSnapshot | null {
  if (!reads) return null;
  const phase = parseConsignmentPhase(reads.phase);
  if (phase == null) return null;
  return {
    mode: "ascending",
    tokenId,
    phase,
    seller: toAddress(reads.seller),
    agent: toAddress(reads.agent),
    floor: reads.floor ?? 0n,
    price: reads.price ?? 0n,
    openedAt: toSeconds(reads.openedAt),
    compensationForm:
      parseCompensationForm(reads.compensationForm) ?? COMPENSATION_FORM.Margin,
    commissionBps: reads.commissionBps ?? 0,
    asset: null,
    denominationKind: null,
    currencyCode: null,
  };
}

export function parseAscendingTerms(
  reads: AscendingTermsReads | null | undefined,
): AscendingTermsSnapshot | null {
  if (!reads) return null;
  const endsAt = toSeconds(reads.endsAt);
  if (endsAt <= 0) return null;
  return {
    duration: toSeconds(reads.duration),
    endsAt,
    extensionWindow: toSeconds(reads.extensionWindow),
    protectionWindow: toSeconds(reads.protectionWindow),
    abandonmentWindow: toSeconds(reads.abandonmentWindow),
    minIncrementBps: reads.minIncrementBps ?? 0,
    highestBidder: toAddress(reads.highestBidder),
    highestBid: reads.highestBid ?? 0n,
  };
}

export function parseAscendingHold(
  reads: AscendingHoldReads | null | undefined,
): AscendingHoldSnapshot | null {
  if (!reads) return null;
  const buyer = toAddress(reads.buyer);
  if (buyer === ZERO_ADDRESS) return null;
  return {
    buyer,
    gross: reads.gross ?? 0n,
    protectionEndsAt: toSeconds(reads.protectionEndsAt),
    frozenRemaining: toSeconds(reads.frozenRemaining),
    reversalPending: reads.reversalPending === true,
    abandonmentDeadline: toSeconds(reads.abandonmentDeadline),
    abandonmentWindow: toSeconds(reads.abandonmentWindow),
  };
}

export function parseAuctionRules(
  tuple: AuctionRulesTuple | null | undefined,
): AuctionRules | null {
  if (!tuple) return null;
  return {
    minDuration: Number(tuple[0]),
    maxDuration: Number(tuple[1]),
    extensionWindow: Number(tuple[2]),
    minIncrementBps: Number(tuple[3]),
    protectionWindow: Number(tuple[4]),
    abandonmentWindow: Number(tuple[5]),
    challengeBond: tuple[6],
  };
}

/**
 * Next admissible bid: the reserve for the first bid, otherwise the standing
 * bid raised by the snapshotted minimum increment (rounded up).
 */
export function ascendingMinNextBid(input: {
  reserve: bigint;
  highestBid: bigint;
  minIncrementBps: number;
}): bigint {
  const { reserve, highestBid, minIncrementBps } = input;
  if (highestBid <= 0n) return reserve;
  const bps = BigInt(Math.max(0, Math.trunc(minIncrementBps)));
  const raised = highestBid + (highestBid * bps + 9999n) / 10000n;
  return raised > highestBid ? raised : highestBid + 1n;
}

/** A lot is binding once the reserve has been met by a standing bid. */
export function ascendingIsBinding(
  terms: AscendingTermsSnapshot | null,
  reserve: bigint,
): boolean {
  if (!terms) return false;
  return terms.highestBid > 0n && terms.highestBid >= reserve;
}

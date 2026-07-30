import {
  type ConsignmentSnapshot,
  ZERO_ADDRESS,
  parseConsignmentPhase,
} from "@/lib/commerce/consignment";
import {
  COMPENSATION_FORM,
  DENOMINATION_KIND,
  ZERO_CURRENCY_CODE,
  parseCompensationForm,
  parseDenominationKind,
} from "@/lib/commerce/denomination";

/** Raw `FixedPriceConsignment` getter results for one token. */
export type FixedPriceConsignmentReads = {
  readonly phase?: number;
  readonly seller?: string;
  readonly agent?: string;
  readonly floor?: bigint;
  readonly price?: bigint;
  readonly openedAt?: bigint | number;
  readonly compensationForm?: number;
  readonly commissionBps?: number;
  readonly asset?: string;
  readonly denomination?: readonly [number, string];
};

function toAddress(value: string | undefined): `0x${string}` {
  if (!value || !value.startsWith("0x")) return ZERO_ADDRESS;
  return value as `0x${string}`;
}

function toSeconds(value: bigint | number | undefined): number {
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return 0;
}

/**
 * Fail-closed parse: any missing phase read yields `null` so callers keep
 * commerce CTAs hidden rather than guessing an idle passport.
 */
export function parseFixedPriceConsignment(
  tokenId: string,
  reads: FixedPriceConsignmentReads | null | undefined,
): ConsignmentSnapshot | null {
  if (!reads) return null;
  const phase = parseConsignmentPhase(reads.phase);
  if (phase == null) return null;

  const denomination = reads.denomination;
  return {
    mode: "fixedPrice",
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
    asset: toAddress(reads.asset),
    denominationKind: denomination
      ? (parseDenominationKind(denomination[0]) ?? DENOMINATION_KIND.Asset)
      : null,
    currencyCode: denomination
      ? ((denomination[1] as `0x${string}`) ?? ZERO_CURRENCY_CODE)
      : null,
  };
}

import { ZERO_ADDRESS, addressesMatch, isZeroAddress } from "@/lib/commerce/consignment";
import {
  COMPENSATION_FORM,
  type CompensationForm,
  DENOMINATION_KIND,
  type DenominationKind,
  ZERO_CURRENCY_CODE,
  parseCompensationForm,
  parseDenominationKind,
} from "@/lib/commerce/denomination";
import type { CommerceMode } from "@/lib/commerce/mode";

/**
 * A mandate is the owner's standing authorization for one agent on one token,
 * per mode contract. It replaces the old escrow agent authorization.
 */
export type MandateSnapshot = {
  readonly mode: CommerceMode;
  readonly tokenId: string;
  readonly agent: `0x${string}`;
  readonly expiry: number;
  readonly asset: `0x${string}`;
  readonly denominationKind: DenominationKind;
  readonly currencyCode: `0x${string}`;
  readonly floor: bigint;
  readonly compensationForm: CompensationForm;
  readonly commissionBps: number;
  readonly active: boolean;
};

export type MandateReads = {
  readonly agent?: string;
  readonly expiry?: bigint | number;
  readonly asset?: string;
  readonly denominationKind?: number;
  readonly currencyCode?: string;
  readonly floor?: bigint;
  readonly compensationForm?: number;
  readonly commissionBps?: number;
  readonly active?: boolean;
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

/** Fail closed: a missing `active` read yields `null`, not an inactive mandate. */
export function parseMandate(
  mode: CommerceMode,
  tokenId: string,
  reads: MandateReads | null | undefined,
): MandateSnapshot | null {
  if (!reads || reads.active == null) return null;
  return {
    mode,
    tokenId,
    agent: toAddress(reads.agent),
    expiry: toSeconds(reads.expiry),
    asset: toAddress(reads.asset),
    denominationKind:
      parseDenominationKind(reads.denominationKind) ?? DENOMINATION_KIND.Asset,
    currencyCode: (reads.currencyCode as `0x${string}`) ?? ZERO_CURRENCY_CODE,
    floor: reads.floor ?? 0n,
    compensationForm:
      parseCompensationForm(reads.compensationForm) ?? COMPENSATION_FORM.Margin,
    commissionBps: reads.commissionBps ?? 0,
    active: reads.active === true,
  };
}

export function mandateHasAgent(mandate: MandateSnapshot | null | undefined): boolean {
  return mandate != null && mandate.active && !isZeroAddress(mandate.agent);
}

export function isMandateExpired(
  mandate: MandateSnapshot | null | undefined,
  nowSeconds: number,
): boolean {
  if (!mandate) return false;
  return mandate.expiry > 0 && mandate.expiry <= nowSeconds;
}

/** An agent may open from a mandate only while it is active and unexpired. */
export function canAgentOpenFromMandate(input: {
  mandate: MandateSnapshot | null | undefined;
  agentAddress: string | null | undefined;
  nowSeconds: number;
}): boolean {
  const { mandate, agentAddress, nowSeconds } = input;
  if (!mandateHasAgent(mandate) || !mandate) return false;
  if (!addressesMatch(mandate.agent, agentAddress)) return false;
  return !isMandateExpired(mandate, nowSeconds);
}

/**
 * Owner floor check mirrored from `ConsignmentBase._requireFloor`: the price an
 * agent sets must never fall below the mandate floor.
 */
export function priceMeetsMandateFloor(input: {
  mandate: MandateSnapshot | null | undefined;
  price: bigint | null | undefined;
}): boolean {
  const { mandate, price } = input;
  if (!mandate || price == null) return false;
  return price >= mandate.floor;
}

export function mandateExpiryLabel(
  mandate: MandateSnapshot | null | undefined,
): string | null {
  if (!mandate || mandate.expiry <= 0) return null;
  return new Date(mandate.expiry * 1000).toISOString().slice(0, 10);
}

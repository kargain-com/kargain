import { ZERO_ADDRESS, isZeroAddress } from "@/lib/commerce/consignment";
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
import {
  mintProtocolOwner,
  protocolAddressesEqual,
  type ProtocolOwner,
} from "@/lib/web3/protocol-address";

/**
 * A mandate is the owner's standing authorization for one agent on one token,
 * per mode contract. It replaces the old escrow agent authorization.
 *
 * `agent` / `asset` are {@link ProtocolOwner} — EIP-155 checksum or SVM base58
 * for the mandate's commercial namespace (never invent a zero from a foreign VM).
 */
export type MandateSnapshot = {
  readonly namespace: number;
  readonly mode: CommerceMode;
  readonly tokenId: string;
  readonly agent: ProtocolOwner;
  readonly expiry: number;
  readonly asset: ProtocolOwner;
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

/** Solana system program — 32 zero bytes; empty agent/asset on SVM mandates. */
const SVM_SYSTEM_PROGRAM = "11111111111111111111111111111111";

function toSeconds(value: bigint | number | undefined): number {
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return 0;
}

/**
 * Mint a protocol address for mandate agent/asset. Missing / unparseable →
 * the namespace's zero/system sentinel so `mandateHasAgent` stays honest.
 */
function mintMandateParty(
  namespace: number,
  value: string | undefined,
): ProtocolOwner {
  if (value) {
    const minted = mintProtocolOwner(namespace, value);
    if (minted != null) return minted;
  }
  // EVM path historically coerced non-0x to ZERO_ADDRESS; SVM → system program.
  const fallback = mintProtocolOwner(namespace, ZERO_ADDRESS);
  if (fallback != null) return fallback;
  const svmZero = mintProtocolOwner(namespace, SVM_SYSTEM_PROGRAM);
  if (svmZero != null) return svmZero;
  // Unreachable for commercial namespaces — fail closed rather than invent a brand.
  throw new Error(`mintMandateParty: no zero sentinel for namespace ${namespace}`);
}

/** True when the agent/asset slot is the empty sentinel for this namespace. */
export function isAbsentMandateParty(
  namespace: number,
  value: string | null | undefined,
): boolean {
  if (!value) return true;
  if (isZeroAddress(value)) return true;
  return protocolAddressesEqual(namespace, value, SVM_SYSTEM_PROGRAM);
}

/** Fail closed: a missing `active` read yields `null`, not an inactive mandate. */
export function parseMandate(
  namespace: number,
  mode: CommerceMode,
  tokenId: string,
  reads: MandateReads | null | undefined,
): MandateSnapshot | null {
  if (!reads || reads.active == null) return null;
  return {
    namespace,
    mode,
    tokenId,
    agent: mintMandateParty(namespace, reads.agent),
    expiry: toSeconds(reads.expiry),
    asset: mintMandateParty(namespace, reads.asset),
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
  return (
    mandate != null &&
    mandate.active &&
    !isAbsentMandateParty(mandate.namespace, mandate.agent)
  );
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
  if (
    !agentAddress ||
    !protocolAddressesEqual(mandate.namespace, mandate.agent, agentAddress)
  ) {
    return false;
  }
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

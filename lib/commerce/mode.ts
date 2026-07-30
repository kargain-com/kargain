import {
  AscendingConsignmentAbi,
  FixedPriceConsignmentAbi,
} from "@/lib/contracts/abis.generated";
import {
  ascendingConsignmentAddress,
  fixedPriceConsignmentAddress,
} from "@/lib/web3/deployment-addresses";

/** Selling modes deployed against a passport (commerce model §2). */
export type CommerceMode = "fixedPrice" | "ascending";

export const COMMERCE_MODES: readonly CommerceMode[] = ["fixedPrice", "ascending"];

/**
 * Mode contract address for a chain, or `undefined` when the mode is not
 * deployed there. Callers must fail closed: disable writes, hide CTAs.
 */
export function commerceModeAddress(
  mode: CommerceMode,
  chainId: number | null | undefined,
): `0x${string}` | undefined {
  if (chainId == null || !Number.isFinite(chainId)) return undefined;
  return mode === "fixedPrice"
    ? fixedPriceConsignmentAddress(chainId)
    : ascendingConsignmentAddress(chainId);
}

export function hasCommerceMode(
  mode: CommerceMode,
  chainId: number | null | undefined,
): boolean {
  return commerceModeAddress(mode, chainId) != null;
}

/**
 * ABI for a mode contract. Shared surfaces (mandate, recall, claims) exist on
 * both, so callers can stay mode-generic.
 */
export function commerceModeAbi(mode: CommerceMode) {
  return mode === "fixedPrice"
    ? FixedPriceConsignmentAbi
    : AscendingConsignmentAbi;
}

export function commerceModeLabel(mode: CommerceMode): string {
  return mode === "fixedPrice" ? "Fixed price" : "Ascending";
}

/** Lowercased mode contract addresses on a chain, for owner/agent matching. */
export function commerceModeAddresses(
  chainId: number | null | undefined,
): Partial<Record<CommerceMode, `0x${string}`>> {
  const out: Partial<Record<CommerceMode, `0x${string}`>> = {};
  for (const mode of COMMERCE_MODES) {
    const address = commerceModeAddress(mode, chainId);
    if (address) out[mode] = address;
  }
  return out;
}

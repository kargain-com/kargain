/**
 * Sole owner of "which program/contract implements a commerce mode on a
 * namespace" — {@link resolveCommerceMode}. Presence is never inferred from the
 * EVM-only hex accessor.
 *
 * {@link commerceModeAddress} remains EVM-only (`0x…`) for ABI/wagmi callers
 * that already know they need hex. It must not be used as a presence gate.
 */

import {
  AscendingConsignmentAbi,
  FixedPriceConsignmentAbi,
} from "@/lib/contracts/abis.generated";
import { isEvmHexAddress } from "@/lib/passport/passport-owner";
import {
  commercialActive,
  type CommercialRegistry,
} from "@/lib/web3/commercial-active";
import {
  ascendingConsignmentAddress,
  fixedPriceConsignmentAddress,
} from "@/lib/web3/deployment-addresses";
import {
  mintProtocolOwner,
  type ProtocolOwner,
} from "@/lib/web3/protocol-address";

/** Selling modes deployed against a passport (commerce model §2). */
export type CommerceMode = "fixedPrice" | "ascending";

export const COMMERCE_MODES: readonly CommerceMode[] = ["fixedPrice", "ascending"];

/**
 * Closed absence causes for {@link resolveCommerceMode}.
 * - unresolved_namespace — input is null / non-finite (no network to name)
 * - mode_not_on_namespace — known namespace, registry has no mode address
 * - mode_address_unusable — registry names an address that will not mint
 */
export type CommerceModeAbsentCause =
  | "unresolved_namespace"
  | "mode_not_on_namespace"
  | "mode_address_unusable";

export const COMMERCE_MODE_ABSENT_CAUSES = [
  "unresolved_namespace",
  "mode_not_on_namespace",
  "mode_address_unusable",
] as const satisfies ReadonlyArray<CommerceModeAbsentCause>;

/**
 * Configured carries a real namespace. Absent-without-namespace has no
 * namespace field — never NaN / -1 / empty invent.
 */
export type CommerceModeResolution =
  | {
      readonly status: "configured";
      readonly address: ProtocolOwner;
      readonly namespace: number;
    }
  | { readonly status: "absent"; readonly cause: "unresolved_namespace" }
  | {
      readonly status: "absent";
      readonly cause: "mode_not_on_namespace" | "mode_address_unusable";
      readonly namespace: number;
    };

/**
 * Namespace-keyed mode answer. Configured when the commercial registry names a
 * mode program/contract id that mints as {@link ProtocolOwner}. Absent is a
 * named cause — never `undefined` / empty string standing for "not deployed".
 */
export function resolveCommerceMode(
  mode: CommerceMode,
  namespace: number | null | undefined,
  registry?: CommercialRegistry,
): CommerceModeResolution {
  if (namespace == null || !Number.isFinite(namespace)) {
    return { status: "absent", cause: "unresolved_namespace" };
  }
  const stack = commercialActive(namespace, registry);
  if (stack == null) {
    return {
      status: "absent",
      cause: "mode_not_on_namespace",
      namespace,
    };
  }
  const raw =
    mode === "fixedPrice"
      ? stack.fixedPriceConsignment
      : stack.ascendingConsignment;
  if (raw == null || raw.length === 0) {
    return {
      status: "absent",
      cause: "mode_not_on_namespace",
      namespace,
    };
  }
  const address = mintProtocolOwner(namespace, raw);
  if (address == null) {
    return {
      status: "absent",
      cause: "mode_address_unusable",
      namespace,
    };
  }
  return { status: "configured", address, namespace };
}

/** Non-empty sentence for a mode-absence cause (§4.21). */
export function commerceModeAbsentCopy(cause: CommerceModeAbsentCause): string {
  switch (cause) {
    case "unresolved_namespace":
      return "This network is not configured in the app.";
    case "mode_not_on_namespace":
      return "This selling mode is not available on this network.";
    case "mode_address_unusable":
      return "This network's mode address cannot be used.";
    default: {
      const _exhaustive: never = cause;
      return _exhaustive;
    }
  }
}

/**
 * EVM-only hex mode address. Presence/absence of a mode is owned by
 * {@link resolveCommerceMode} — do not treat `undefined` here as "not deployed"
 * on a commercial SVM namespace (hex cannot represent base58 program ids).
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
  registry?: CommercialRegistry,
): boolean {
  return resolveCommerceMode(mode, chainId, registry).status === "configured";
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

/**
 * Configured mode addresses on a namespace (EVM hex or SVM base58 ProtocolOwner).
 * Empty when neither mode is configured — not a presence gate by itself.
 */
export function commerceModeAddresses(
  chainId: number | null | undefined,
  registry?: CommercialRegistry,
): Partial<Record<CommerceMode, ProtocolOwner>> {
  const out: Partial<Record<CommerceMode, ProtocolOwner>> = {};
  for (const mode of COMMERCE_MODES) {
    const resolved = resolveCommerceMode(mode, chainId, registry);
    if (resolved.status === "configured") out[mode] = resolved.address;
  }
  return out;
}

/**
 * Hex address for EVM ABI/wagmi when the mode is configured and EVM-shaped.
 * Prefer this over {@link commerceModeAddress} when presence was already
 * answered by {@link resolveCommerceMode} and only the hex wire is needed.
 */
export function commerceModeEvmAddress(
  mode: CommerceMode,
  namespace: number | null | undefined,
  registry?: CommercialRegistry,
): `0x${string}` | undefined {
  const resolved = resolveCommerceMode(mode, namespace, registry);
  if (resolved.status !== "configured") return undefined;
  if (!isEvmHexAddress(resolved.address)) return undefined;
  return resolved.address;
}

/**
 * Sole normalize/compare owner for protocol addresses keyed by namespace (SPEC §I.12.12).
 *
 * EVM: checksum via viem `getAddress`; equality is case-insensitive hex.
 * Non-EVM variants are not registered yet — callers fail closed via normalize null.
 */

import { getAddress } from "viem";

import { commercialActive } from "@/lib/web3/commercial-active";

function evmNormalize(address: string): `0x${string}` | null {
  try {
    return getAddress(address);
  } catch {
    return null;
  }
}

/**
 * Normalize a protocol address for `namespace`.
 * Unknown namespace still attempts EVM checksum (local/hardhat denylist paths).
 */
export function normalizeProtocolAddress(
  namespace: number,
  address: string,
): string | null {
  const stack = commercialActive(namespace);
  if (stack != null && stack.vm !== "evm") {
    return null;
  }
  return evmNormalize(address);
}

/** Equality of two protocol addresses on the same namespace. */
export function protocolAddressesEqual(
  namespace: number,
  a: string,
  b: string,
): boolean {
  const na = normalizeProtocolAddress(namespace, a);
  const nb = normalizeProtocolAddress(namespace, b);
  if (na == null || nb == null) return false;
  const stack = commercialActive(namespace);
  if (stack != null && stack.vm !== "evm") return false;
  // EVM compare — sole site of protocol address case-fold.
  return na.toLowerCase() === nb.toLowerCase();
}

/** Dedup key for an already-normalized (or raw) EVM protocol address. */
export function protocolAddressDedupKey(
  namespace: number,
  address: string,
): string | null {
  const normalized = normalizeProtocolAddress(namespace, address);
  if (normalized == null) return null;
  const stack = commercialActive(namespace);
  if (stack != null && stack.vm !== "evm") return null;
  return normalized.toLowerCase();
}

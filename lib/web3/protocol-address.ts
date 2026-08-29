/**
 * Sole normalize/compare owner for protocol addresses keyed by namespace (SPEC §I.12.12).
 *
 * EVM: checksum via viem `getAddress`; equality is case-insensitive hex.
 * SVM: canonical base58 of a 32-byte pubkey; equality is case-sensitive.
 * Unregistered reserved-band namespaces dispatch SVM; other unknown namespaces
 * still attempt EVM checksum (local/hardhat denylist paths).
 */

import { getAddress, type Hex } from "viem";

import { commercialActive } from "@/lib/web3/commercial-active";
import { isReservedNonEvmNamespace } from "@/lib/web3/kargain-namespace";

export type ProtocolVm = "evm" | "svm";

/** Bitcoin / Solana base58 alphabet (no 0/O/I/l). */
const BASE58_ALPHABET =
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

const BASE58_MAP: Int16Array = (() => {
  const map = new Int16Array(128).fill(-1);
  for (let i = 0; i < BASE58_ALPHABET.length; i++) {
    map[BASE58_ALPHABET.charCodeAt(i)] = i;
  }
  return map;
})();

function evmNormalize(address: string): `0x${string}` | null {
  try {
    return getAddress(address);
  } catch {
    return null;
  }
}

function base58Decode(encoded: string): Uint8Array | null {
  if (encoded.length === 0) return null;
  let ones = 0;
  for (let i = 0; i < encoded.length && encoded[i] === "1"; i++) ones++;

  const size = Math.ceil((encoded.length * Math.log(58)) / Math.log(256));
  const bytes = new Uint8Array(size);
  let length = 0;
  for (let i = ones; i < encoded.length; i++) {
    const c = encoded.charCodeAt(i);
    if (c >= 128) return null;
    let carry = BASE58_MAP[c];
    if (carry < 0) return null;
    for (let j = 0; j < length; j++) {
      carry += 58 * bytes[j];
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      if (length >= bytes.length) return null;
      bytes[length] = carry & 0xff;
      length++;
      carry >>= 8;
    }
  }

  const out = new Uint8Array(ones + length);
  out.fill(0, 0, ones);
  for (let i = 0; i < length; i++) {
    out[ones + i] = bytes[length - 1 - i];
  }
  return out;
}

function base58Encode(bytes: Uint8Array): string {
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;

  const size = Math.ceil((bytes.length * Math.log(256)) / Math.log(58)) + 1;
  const digits = new Uint8Array(size);
  let length = 0;
  for (let i = zeros; i < bytes.length; i++) {
    let carry = bytes[i];
    for (let j = 0; j < length; j++) {
      carry += 256 * digits[j];
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits[length] = carry % 58;
      length++;
      carry = (carry / 58) | 0;
    }
  }

  let out = "1".repeat(zeros);
  for (let i = length - 1; i >= 0; i--) {
    out += BASE58_ALPHABET[digits[i]];
  }
  return out;
}

function svmNormalize(address: string): string | null {
  const decoded = base58Decode(address);
  if (decoded == null || decoded.length !== 32) return null;
  return base58Encode(decoded);
}

function vmForNamespace(namespace: number): ProtocolVm {
  const stack = commercialActive(namespace);
  if (stack != null) return stack.vm;
  if (isReservedNonEvmNamespace(namespace)) return "svm";
  return "evm";
}

/**
 * Normalize a protocol address for an explicit VM class.
 * Snapshot tooling uses this when no commercial registry row exists yet.
 */
export function normalizeProtocolAddressForVm(
  vm: ProtocolVm,
  address: string,
): string | null {
  if (vm === "svm") return svmNormalize(address);
  return evmNormalize(address);
}

/**
 * Normalize a protocol address for `namespace`.
 * Unknown namespace still attempts EVM checksum (local/hardhat denylist paths)
 * unless the value sits in the SPEC §13.1 reserved non-EVM band.
 */
export function normalizeProtocolAddress(
  namespace: number,
  address: string,
): string | null {
  return normalizeProtocolAddressForVm(vmForNamespace(namespace), address);
}

/** Equality of two protocol addresses on the same namespace. */
export function protocolAddressesEqual(
  namespace: number,
  a: string,
  b: string,
): boolean {
  const vm = vmForNamespace(namespace);
  const na = normalizeProtocolAddressForVm(vm, a);
  const nb = normalizeProtocolAddressForVm(vm, b);
  if (na == null || nb == null) return false;
  if (vm === "svm") return na === nb;
  // EVM compare — sole site of protocol address case-fold.
  return na.toLowerCase() === nb.toLowerCase();
}

/** Dedup key for an already-normalized (or raw) protocol address. */
export function protocolAddressDedupKey(
  namespace: number,
  address: string,
): string | null {
  const vm = vmForNamespace(namespace);
  const normalized = normalizeProtocolAddressForVm(vm, address);
  if (normalized == null) return null;
  if (vm === "svm") return normalized;
  return normalized.toLowerCase();
}

/**
 * Encode a protocol address as LayerZero `bytes32` peer.
 * EVM: left-pad 20-byte checksum to 32. SVM: 32-byte pubkey as-is (no pad).
 */
export function protocolAddressToBytes32(
  vm: ProtocolVm,
  address: string,
): Hex | null {
  if (vm === "evm") {
    const normalized = evmNormalize(address);
    if (normalized == null) return null;
    return `0x${"00".repeat(12)}${normalized.slice(2).toLowerCase()}` as Hex;
  }
  const decoded = base58Decode(address.trim());
  if (decoded == null || decoded.length !== 32) return null;
  let hex = "0x";
  for (let i = 0; i < 32; i++) {
    hex += decoded[i]!.toString(16).padStart(2, "0");
  }
  return hex as Hex;
}

/** Solana base58 pubkey → bytes32 peer (sole SVM peer encoding). */
export function svmPubkeyToBytes32(base58Pubkey: string): Hex {
  const out = protocolAddressToBytes32("svm", base58Pubkey);
  if (out == null) {
    throw new Error(`Invalid Solana pubkey for bytes32 peer: ${base58Pubkey}`);
  }
  return out;
}

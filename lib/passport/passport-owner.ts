import {
  normalizeProtocolAddressForVm,
  protocolAddressesEqual,
} from "@/lib/web3/protocol-address";

/**
 * Wallet equality. When `namespace` is known, compare via the protocol-address
 * owner (EVM casefold / SVM canonical base58). Without a namespace, fall back to
 * case-insensitive compare for legacy EVM-only call sites.
 */
export function isSameWallet(
  a?: string | null,
  b?: string | null,
  namespace?: number,
): boolean {
  if (!a || !b) return false;
  if (namespace != null) return protocolAddressesEqual(namespace, a, b);
  return a.toLowerCase() === b.toLowerCase();
}

/**
 * Prefer a live EIP-155 `ownerOf` when present; otherwise the entity/ponder
 * owner string (hex or base58). Never invent an address.
 */
export function resolveEffectiveOnChainOwner(
  onChainOwner?: string | null,
  ponderOwner?: string | null,
): string | undefined {
  return onChainOwner ?? ponderOwner ?? undefined;
}

export function isOnChainNftOwner(
  address?: string | null,
  onChainOwner?: string | null,
  namespace?: number,
): boolean {
  return isSameWallet(address, onChainOwner, namespace);
}

type PassportHolderInput = {
  address?: string | null;
  onChainOwner?: string | null;
  ponderOwner?: string | null;
  listingActive?: boolean;
  listingSeller?: string | null;
  /** Commercial namespace for protocol compare when known. */
  namespace?: number;
};

export function isPassportHolder({
  address,
  onChainOwner,
  ponderOwner,
  listingActive,
  listingSeller,
  namespace,
}: PassportHolderInput): boolean {
  if (!address) return false;

  if (listingActive && listingSeller) {
    return isSameWallet(address, listingSeller, namespace);
  }

  const effectiveOwner = resolveEffectiveOnChainOwner(onChainOwner, ponderOwner);
  return isOnChainNftOwner(address, effectiveOwner, namespace);
}

/** True when the string is a checksummable EIP-155 address (messaging / ENS leaves). */
export function isEvmHexAddress(address: string): address is `0x${string}` {
  return normalizeProtocolAddressForVm("evm", address) != null;
}

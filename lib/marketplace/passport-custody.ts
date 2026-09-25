/**
 * Escrow / mode-hold chrome — Seller vs Owner when a commerce mode holds the NFT.
 * Distinct from network-location custody (`lib/custody/fold` / ponder-passport-custody).
 *
 * Addresses are namespace-scoped strings (EVM hex or SVM base58). Never coerce an
 * entity-sourced owner through viem `getAddress`.
 */

import {
  COMMERCE_MODES,
  resolveCommerceMode,
} from "@/lib/commerce/mode";
import {
  normalizeProtocolAddress,
  protocolAddressesEqual,
  type ProtocolOwner,
} from "@/lib/web3/protocol-address";

export type PassportCustody = {
  profileAddress: string;
  custodyAddress?: string;
  isEscrowed: boolean;
};

type ResolvePassportCustodyInput = {
  chainId: number;
  passportOwner: ProtocolOwner | string;
  listing?: {
    active: boolean;
    seller: string;
  } | null;
};

/** Mode program/contract ids on this namespace — via resolveCommerceMode only. */
function modeAddressStrings(chainId: number): string[] {
  const out: string[] = [];
  for (const mode of COMMERCE_MODES) {
    const resolved = resolveCommerceMode(mode, chainId);
    if (resolved.status === "configured") out.push(resolved.address);
  }
  return out;
}

function displayAddress(chainId: number, address: string): string {
  return normalizeProtocolAddress(chainId, address) ?? address.trim();
}

export function resolvePassportCustody({
  chainId,
  passportOwner,
  listing,
}: ResolvePassportCustodyInput): PassportCustody {
  const ownerRaw = passportOwner.trim();
  const modes = modeAddressStrings(chainId);
  const heldByMode =
    listing?.active === true &&
    modes.some((mode) => protocolAddressesEqual(chainId, ownerRaw, mode));

  if (heldByMode && listing?.seller) {
    return {
      profileAddress: displayAddress(chainId, listing.seller),
      custodyAddress: displayAddress(chainId, ownerRaw),
      isEscrowed: true,
    };
  }

  return {
    profileAddress: displayAddress(chainId, ownerRaw),
    isEscrowed: false,
  };
}

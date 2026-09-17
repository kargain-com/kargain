/**
 * Escrow / mode-hold chrome — Seller vs Owner when a commerce mode holds the NFT.
 * Distinct from network-location custody (`lib/custody/fold` / ponder-passport-custody).
 *
 * Addresses are namespace-scoped strings (EVM hex or SVM base58). Never coerce an
 * entity-sourced owner through viem `getAddress`.
 */

import { commerceModeAddresses } from "@/lib/commerce/mode";
import { commercialActive } from "@/lib/web3/commercial-active";
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

/** Mode program/contract ids on this namespace — EVM hex or SVM base58. */
function modeAddressStrings(chainId: number): string[] {
  const fromEvmAccessors = Object.values(commerceModeAddresses(chainId)).filter(
    (a): a is NonNullable<typeof a> => a != null && a.length > 0,
  );
  if (fromEvmAccessors.length > 0) return [...fromEvmAccessors];

  // Commercial rows may carry mode ids as strings when EVM accessors are unset.
  // Read optional fields when present — no VM identity fork here.
  const stack = commercialActive(chainId);
  if (stack == null) return [];
  const out: string[] = [];
  if (
    "fixedPriceConsignment" in stack &&
    typeof stack.fixedPriceConsignment === "string" &&
    stack.fixedPriceConsignment.length > 0
  ) {
    out.push(stack.fixedPriceConsignment);
  }
  if (
    "ascendingConsignment" in stack &&
    typeof stack.ascendingConsignment === "string" &&
    stack.ascendingConsignment.length > 0
  ) {
    out.push(stack.ascendingConsignment);
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

/**
 * ClaimablePayouts inheritors on a commercial stack.
 * Addresses resolve only through COMMERCIAL_ACTIVE — no literals.
 * Fifth money-moving contract: append a key here + ponder dualEntry + handler factory call.
 */

import {
  commercialActive,
  type CommercialActiveStack,
} from "@/lib/web3/commercial-active";

export const CLAIMABLE_STACK_KEYS = [
  "karPassport",
  "karProStaking",
  "fixedPriceConsignment",
  "ascendingConsignment",
] as const;

export type ClaimableStackKey = (typeof CLAIMABLE_STACK_KEYS)[number];

export type ClaimableContractRole =
  | "passport"
  | "staking"
  | "fixedPrice"
  | "ascending";

const ROLE_BY_KEY: Record<ClaimableStackKey, ClaimableContractRole> = {
  karPassport: "passport",
  karProStaking: "staking",
  fixedPriceConsignment: "fixedPrice",
  ascendingConsignment: "ascending",
};

export type ClaimableContractEntry = {
  key: ClaimableStackKey;
  role: ClaimableContractRole;
  address: `0x${string}`;
};

export function claimableContractsForChain(
  chainId: number,
): ClaimableContractEntry[] {
  const stack = commercialActive(chainId);
  if (!stack) return [];
  const out: ClaimableContractEntry[] = [];
  for (const key of CLAIMABLE_STACK_KEYS) {
    const address = stack[key as keyof CommercialActiveStack];
    if (typeof address !== "string" || !address.startsWith("0x")) continue;
    out.push({
      key,
      role: ROLE_BY_KEY[key],
      address: address as `0x${string}`,
    });
  }
  return out;
}

/** Reverse-lookup role from an emitting contract address on a known commercial chain. */
export function claimableRoleForAddress(
  chainId: number,
  contract: `0x${string}`,
): ClaimableContractRole | null {
  const lower = contract.toLowerCase();
  for (const entry of claimableContractsForChain(chainId)) {
    if (entry.address.toLowerCase() === lower) return entry.role;
  }
  return null;
}

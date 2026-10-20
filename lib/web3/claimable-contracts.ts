/**
 * ClaimablePayouts inheritors on a commercial stack.
 * Passport/staking come from the held stack when EVM-shaped (0x…);
 * modes go through commerce/mode (never a direct stack mode-field read).
 * Fifth money-moving contract: append here + ponder dualEntry + handler factory call.
 */

import { commerceModeEvmAddress } from "@/lib/commerce/mode";
import { commercialActive } from "@/lib/web3/commercial-active";

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

function evmHex(value: string | undefined): `0x${string}` | undefined {
  if (value == null || !value.startsWith("0x")) return undefined;
  return value as `0x${string}`;
}

export function claimableContractsForChain(
  chainId: number,
): ClaimableContractEntry[] {
  const stack = commercialActive(chainId);
  if (stack == null) return [];
  const out: ClaimableContractEntry[] = [];

  const push = (key: ClaimableStackKey, address: `0x${string}` | undefined) => {
    if (address == null) return;
    out.push({ key, role: ROLE_BY_KEY[key], address });
  };

  push("karPassport", evmHex(stack.karPassport));
  push("karProStaking", evmHex(stack.karProStaking));
  push("fixedPriceConsignment", commerceModeEvmAddress("fixedPrice", chainId));
  push("ascendingConsignment", commerceModeEvmAddress("ascending", chainId));
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

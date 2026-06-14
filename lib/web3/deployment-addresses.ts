import { getAddress } from "viem";

import { DEFAULT_CHAIN_ID } from "./supported-chains";

/** Base Sepolia (84532) — Model X, redeployed June 2026 */
export const BASE_SEPOLIA_CHAIN_ID = 84532;

/** Hardhat localhost (persistent node) */
export const LOCALHOST_CHAIN_ID = 31337;

const SEPOLIA = {
  karPassport: "0xCfA1eAB89D6D1DE1244CF346D5a4F1E7343E9083",
  marketplace: "0xcD40C83CD57422C616e7e63F562B2e78C269Fb7F",
  karProPass: "0x8e4dcb5C0b415d6c2481D72dFac6da32d9cf22C1",
  karProStaking: "0x2794015C00Da0FAf5D2451Ffba9FdD30F86dBC31",
  usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  timelock: "0xcf1Eb0E7ed453Ed266bF90E7C09e0E4769580b77",
  nativeFeed: "0x4aDC67696bA383F43DD60A9e78F2C97Fbbfc7cb1",
  eurFeed: "0xb49f677943BC038e9857d61E7d053CaA2C1734C1",
} as const satisfies Record<string, `0x${string}`>;

type AddressKey =
  | "karPassport"
  | "marketplace"
  | "karProPass"
  | "karProStaking"
  | "usdc"
  | "timelock"
  | "nativeFeed"
  | "eurFeed";

const ENV_SINGLE: Record<AddressKey, string> = {
  karPassport: "NEXT_PUBLIC_KAR_PASSPORT_ADDRESS",
  marketplace: "NEXT_PUBLIC_MARKETPLACE_ADDRESS",
  karProPass: "NEXT_PUBLIC_KAR_PRO_PASS_ADDRESS",
  karProStaking: "NEXT_PUBLIC_KAR_PRO_STAKING_ADDRESS",
  usdc: "NEXT_PUBLIC_USDC_ADDRESS",
  timelock: "NEXT_PUBLIC_TIMELOCK_ADDRESS",
  nativeFeed: "NEXT_PUBLIC_NATIVE_FEED_ADDRESS",
  eurFeed: "NEXT_PUBLIC_EUR_FEED_ADDRESS",
};

const ENV_BY_CHAIN: Record<AddressKey, string> = {
  karPassport: "NEXT_PUBLIC_KAR_PASSPORT_BY_CHAIN",
  marketplace: "NEXT_PUBLIC_MARKETPLACE_BY_CHAIN",
  karProPass: "NEXT_PUBLIC_KAR_PRO_PASS_BY_CHAIN",
  karProStaking: "NEXT_PUBLIC_KAR_PRO_STAKING_BY_CHAIN",
  usdc: "NEXT_PUBLIC_USDC_BY_CHAIN",
  timelock: "NEXT_PUBLIC_TIMELOCK_BY_CHAIN",
  nativeFeed: "NEXT_PUBLIC_NATIVE_FEED_BY_CHAIN",
  eurFeed: "NEXT_PUBLIC_EUR_FEED_BY_CHAIN",
};

function parseJsonMap(raw: string | undefined): Record<string, string> {
  if (!raw?.trim()) return {};
  try {
    return JSON.parse(raw) as Record<string, string>;
  } catch {
    return {};
  }
}

function resolveAddress(key: AddressKey, chainId?: number): `0x${string}` | undefined {
  const cid = chainId ?? DEFAULT_CHAIN_ID;
  const chainKey = String(cid);

  const byChain = parseJsonMap(process.env[ENV_BY_CHAIN[key] as keyof NodeJS.ProcessEnv] as string);
  const fromMap = byChain[chainKey];
  if (fromMap) return getAddress(fromMap as `0x${string}`);

  const single = process.env[ENV_SINGLE[key] as keyof NodeJS.ProcessEnv] as string | undefined;
  if (single && cid === DEFAULT_CHAIN_ID) return getAddress(single as `0x${string}`);

  if (cid === BASE_SEPOLIA_CHAIN_ID) {
    return SEPOLIA[key];
  }

  return undefined;
}

export function karPassportAddress(chainId?: number): `0x${string}` | undefined {
  return resolveAddress("karPassport", chainId);
}

export function marketplaceAddress(chainId?: number): `0x${string}` | undefined {
  return resolveAddress("marketplace", chainId);
}

export function karProPassAddress(chainId?: number): `0x${string}` | undefined {
  return resolveAddress("karProPass", chainId);
}

export function karProStakingAddress(chainId?: number): `0x${string}` | undefined {
  return resolveAddress("karProStaking", chainId);
}

export function usdcAddress(chainId?: number): `0x${string}` | undefined {
  return resolveAddress("usdc", chainId);
}

export function kargainTimelockAddress(chainId?: number): `0x${string}` | undefined {
  return resolveAddress("timelock", chainId);
}

export function chainlinkNativeUsdFeed(chainId?: number): `0x${string}` | undefined {
  return resolveAddress("nativeFeed", chainId);
}

export function chainlinkEurUsdFeed(chainId?: number): `0x${string}` | undefined {
  return resolveAddress("eurFeed", chainId);
}

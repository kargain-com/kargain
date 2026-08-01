import { getAddress } from "viem";

import { commercialActive } from "./commercial-active";
import {
  ETHEREUM_SEPOLIA_HISTORICAL_DENYLIST,
  SEPOLIA_HISTORICAL_DENYLIST,
} from "./sepolia-addresses";

/** Base Sepolia (84532) */
export const BASE_SEPOLIA_CHAIN_ID = 84532;

/** Ethereum Sepolia (11155111) */
export const ETHEREUM_SEPOLIA_CHAIN_ID = 11155111;

/** Hardhat localhost (persistent node) */
export const LOCALHOST_CHAIN_ID = 31337;

type AddressKey =
  | "karPassport"
  | "karProPass"
  | "karProStaking"
  | "usdc"
  | "nativeFeed"
  | "eurFeed";

type OptionalV2Key = "timelock" | "bridgeGateway";

/** Commerce modes — on COMMERCIAL_ACTIVE (Nuclear #3); fail closed when unset (SPEC §I.9.x). */
type OptionalModeKey = "fixedPriceConsignment" | "ascendingConsignment";

const ENV_SINGLE: Record<AddressKey | OptionalV2Key | OptionalModeKey, string> = {
  karPassport: "NEXT_PUBLIC_KAR_PASSPORT_ADDRESS",
  karProPass: "NEXT_PUBLIC_KAR_PRO_PASS_ADDRESS",
  karProStaking: "NEXT_PUBLIC_KAR_PRO_STAKING_ADDRESS",
  usdc: "NEXT_PUBLIC_USDC_ADDRESS",
  timelock: "NEXT_PUBLIC_TIMELOCK_ADDRESS",
  bridgeGateway: "NEXT_PUBLIC_BRIDGE_GATEWAY_ADDRESS",
  fixedPriceConsignment: "NEXT_PUBLIC_FIXED_PRICE_CONSIGNMENT_ADDRESS",
  ascendingConsignment: "NEXT_PUBLIC_ASCENDING_CONSIGNMENT_ADDRESS",
  nativeFeed: "NEXT_PUBLIC_NATIVE_FEED_ADDRESS",
  eurFeed: "NEXT_PUBLIC_EUR_FEED_ADDRESS",
};

const ENV_BY_CHAIN: Record<AddressKey | OptionalV2Key | OptionalModeKey, string> = {
  karPassport: "NEXT_PUBLIC_KAR_PASSPORT_BY_CHAIN",
  karProPass: "NEXT_PUBLIC_KAR_PRO_PASS_BY_CHAIN",
  karProStaking: "NEXT_PUBLIC_KAR_PRO_STAKING_BY_CHAIN",
  usdc: "NEXT_PUBLIC_USDC_BY_CHAIN",
  timelock: "NEXT_PUBLIC_TIMELOCK_BY_CHAIN",
  bridgeGateway: "NEXT_PUBLIC_BRIDGE_GATEWAY_BY_CHAIN",
  fixedPriceConsignment: "NEXT_PUBLIC_FIXED_PRICE_CONSIGNMENT_BY_CHAIN",
  ascendingConsignment: "NEXT_PUBLIC_ASCENDING_CONSIGNMENT_BY_CHAIN",
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

function resolveAddress(key: AddressKey, chainId: number): `0x${string}` | undefined {
  const chainKey = String(chainId);

  const byChain = parseJsonMap(process.env[ENV_BY_CHAIN[key] as keyof NodeJS.ProcessEnv] as string);
  const fromMap = byChain[chainKey];
  if (fromMap) return getAddress(fromMap as `0x${string}`);

  // Single-env overrides apply only to local Hardhat — never as a silent hub alias.
  const single = process.env[ENV_SINGLE[key] as keyof NodeJS.ProcessEnv] as string | undefined;
  if (single && chainId === LOCALHOST_CHAIN_ID) return getAddress(single as `0x${string}`);

  const active = commercialActive(chainId);
  if (active) return active[key];

  return undefined;
}

export function karPassportAddress(chainId: number): `0x${string}` | undefined {
  return resolveAddress("karPassport", chainId);
}

export function karProPassAddress(chainId: number): `0x${string}` | undefined {
  return resolveAddress("karProPass", chainId);
}

export function karProStakingAddress(chainId: number): `0x${string}` | undefined {
  return resolveAddress("karProStaking", chainId);
}

export function usdcAddress(chainId: number): `0x${string}` | undefined {
  return resolveAddress("usdc", chainId);
}

export function kargainTimelockAddress(chainId: number): `0x${string}` | undefined {
  return resolveOptionalAddress("timelock", chainId);
}

export function bridgeGatewayAddress(chainId: number): `0x${string}` | undefined {
  return resolveOptionalAddress("bridgeGateway", chainId);
}

function resolveOptionalAddress(
  key: OptionalV2Key | OptionalModeKey,
  chainId: number,
): `0x${string}` | undefined {
  const chainKey = String(chainId);

  const byChain = parseJsonMap(
    process.env[ENV_BY_CHAIN[key] as keyof NodeJS.ProcessEnv] as string,
  );
  const fromMap = byChain[chainKey];
  if (fromMap) return getAddress(fromMap as `0x${string}`);

  const single = process.env[ENV_SINGLE[key] as keyof NodeJS.ProcessEnv] as string | undefined;
  if (single && chainId === LOCALHOST_CHAIN_ID) return getAddress(single as `0x${string}`);

  const active = commercialActive(chainId);
  if (active) return active[key];

  return undefined;
}

/** Commerce mode — Nuclear #3 COMMERCIAL_ACTIVE; fails closed (`undefined`) when unset. */
export function fixedPriceConsignmentAddress(chainId: number): `0x${string}` | undefined {
  return resolveOptionalAddress("fixedPriceConsignment", chainId);
}

/** Commerce mode — Nuclear #3 COMMERCIAL_ACTIVE; fails closed (`undefined`) when unset. */
export function ascendingConsignmentAddress(chainId: number): `0x${string}` | undefined {
  return resolveOptionalAddress("ascendingConsignment", chainId);
}

export function chainlinkNativeUsdFeed(chainId: number): `0x${string}` | undefined {
  return resolveAddress("nativeFeed", chainId);
}

export function chainlinkEurUsdFeed(chainId: number): `0x${string}` | undefined {
  return resolveAddress("eurFeed", chainId);
}

function historicalDenylist(chainId: number): readonly `0x${string}`[] {
  if (chainId === BASE_SEPOLIA_CHAIN_ID) return SEPOLIA_HISTORICAL_DENYLIST;
  if (chainId === ETHEREUM_SEPOLIA_CHAIN_ID) return ETHEREUM_SEPOLIA_HISTORICAL_DENYLIST;
  return [];
}

/**
 * Kargain-owned contracts for profile/messaging denylist on `chainId`
 * (active commercial stack + per-chain historical). Excludes timelock.
 * SPEC §I.12.12 — never apply chain-blind.
 */
export function kargainContractDenylist(chainId: number): readonly `0x${string}`[] {
  const active = commercialActive(chainId);
  if (!active) return [];
  return [
    active.karPassport,
    active.karProPass,
    active.karProStaking,
    active.bridgeGateway,
    ...(active.fixedPriceConsignment ? [active.fixedPriceConsignment] : []),
    ...(active.ascendingConsignment ? [active.ascendingConsignment] : []),
    ...historicalDenylist(chainId),
  ];
}

import { getAddress } from "viem";

import { commercialActive } from "./commercial-active";
import { SEPOLIA_HISTORICAL_DENYLIST } from "./sepolia-addresses";
import { DEFAULT_CHAIN_ID } from "./supported-chains";

/** Base Sepolia (84532) */
export const BASE_SEPOLIA_CHAIN_ID = 84532;

/** Hardhat localhost (persistent node) */
export const LOCALHOST_CHAIN_ID = 31337;

type AddressKey =
  | "karPassport"
  | "marketplace"
  | "karProPass"
  | "karProStaking"
  | "usdc"
  | "nativeFeed"
  | "eurFeed";

type OptionalV2Key = "timelock" | "proxyOnftAdapter" | "auctionEscrow";

const ENV_SINGLE: Record<AddressKey | OptionalV2Key, string> = {
  karPassport: "NEXT_PUBLIC_KAR_PASSPORT_ADDRESS",
  marketplace: "NEXT_PUBLIC_MARKETPLACE_ADDRESS",
  karProPass: "NEXT_PUBLIC_KAR_PRO_PASS_ADDRESS",
  karProStaking: "NEXT_PUBLIC_KAR_PRO_STAKING_ADDRESS",
  usdc: "NEXT_PUBLIC_USDC_ADDRESS",
  timelock: "NEXT_PUBLIC_TIMELOCK_ADDRESS",
  proxyOnftAdapter: "NEXT_PUBLIC_PROXY_ONFT_ADAPTER_ADDRESS",
  auctionEscrow: "NEXT_PUBLIC_AUCTION_ESCROW_ADDRESS",
  nativeFeed: "NEXT_PUBLIC_NATIVE_FEED_ADDRESS",
  eurFeed: "NEXT_PUBLIC_EUR_FEED_ADDRESS",
};

const ENV_BY_CHAIN: Record<AddressKey | OptionalV2Key, string> = {
  karPassport: "NEXT_PUBLIC_KAR_PASSPORT_BY_CHAIN",
  marketplace: "NEXT_PUBLIC_MARKETPLACE_BY_CHAIN",
  karProPass: "NEXT_PUBLIC_KAR_PRO_PASS_BY_CHAIN",
  karProStaking: "NEXT_PUBLIC_KAR_PRO_STAKING_BY_CHAIN",
  usdc: "NEXT_PUBLIC_USDC_BY_CHAIN",
  timelock: "NEXT_PUBLIC_TIMELOCK_BY_CHAIN",
  proxyOnftAdapter: "NEXT_PUBLIC_PROXY_ONFT_ADAPTER_BY_CHAIN",
  auctionEscrow: "NEXT_PUBLIC_AUCTION_ESCROW_BY_CHAIN",
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

  const active = commercialActive(cid);
  if (active) return active[key];

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
  return resolveOptionalAddress("timelock", chainId);
}

export function proxyOnftAdapterAddress(chainId?: number): `0x${string}` | undefined {
  return resolveOptionalAddress("proxyOnftAdapter", chainId);
}

export function auctionEscrowAddress(chainId?: number): `0x${string}` | undefined {
  return resolveOptionalAddress("auctionEscrow", chainId);
}

function resolveOptionalAddress(key: OptionalV2Key, chainId?: number): `0x${string}` | undefined {
  const cid = chainId ?? DEFAULT_CHAIN_ID;
  const chainKey = String(cid);

  const byChain = parseJsonMap(
    process.env[ENV_BY_CHAIN[key] as keyof NodeJS.ProcessEnv] as string,
  );
  const fromMap = byChain[chainKey];
  if (fromMap) return getAddress(fromMap as `0x${string}`);

  const single = process.env[ENV_SINGLE[key] as keyof NodeJS.ProcessEnv] as string | undefined;
  if (single && cid === DEFAULT_CHAIN_ID) return getAddress(single as `0x${string}`);

  const active = commercialActive(cid);
  if (active) return active[key];

  return undefined;
}

export function chainlinkNativeUsdFeed(chainId?: number): `0x${string}` | undefined {
  return resolveAddress("nativeFeed", chainId);
}

export function chainlinkEurUsdFeed(chainId?: number): `0x${string}` | undefined {
  return resolveAddress("eurFeed", chainId);
}

function historicalDenylist(chainId: number): readonly `0x${string}`[] {
  return chainId === BASE_SEPOLIA_CHAIN_ID ? SEPOLIA_HISTORICAL_DENYLIST : [];
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
    active.marketplace,
    active.karProPass,
    active.karProStaking,
    active.proxyOnftAdapter,
    active.auctionEscrow,
    ...historicalDenylist(chainId),
  ];
}

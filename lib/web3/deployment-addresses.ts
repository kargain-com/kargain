import { getAddress } from "viem";

import { SEPOLIA_ACTIVE, SEPOLIA_HISTORICAL_DENYLIST } from "./sepolia-addresses";
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

  if (cid === BASE_SEPOLIA_CHAIN_ID) {
    return SEPOLIA_ACTIVE[key];
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

  if (cid === BASE_SEPOLIA_CHAIN_ID) {
    return SEPOLIA_ACTIVE[key];
  }

  return undefined;
}

export function chainlinkNativeUsdFeed(chainId?: number): `0x${string}` | undefined {
  return resolveAddress("nativeFeed", chainId);
}

export function chainlinkEurUsdFeed(chainId?: number): `0x${string}` | undefined {
  return resolveAddress("eurFeed", chainId);
}

const SEPOLIA_KARGAIN_CONTRACTS: `0x${string}`[] = [
  SEPOLIA_ACTIVE.karPassport,
  SEPOLIA_ACTIVE.marketplace,
  SEPOLIA_ACTIVE.karProPass,
  SEPOLIA_ACTIVE.karProStaking,
  SEPOLIA_ACTIVE.proxyOnftAdapter,
  ...SEPOLIA_HISTORICAL_DENYLIST,
];

/** Kargain-owned contracts on Base Sepolia (active + historical) for profile/messaging denylist. Excludes timelock. */
export function sepoliaKargainContractDenylist(): readonly `0x${string}`[] {
  return SEPOLIA_KARGAIN_CONTRACTS;
}

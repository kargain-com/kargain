import { getAddress } from "viem";

import { DEFAULT_CHAIN_ID } from "./supported-chains";

/** Base Sepolia (84532) — Model X v1.1 partial redeploy, June 2026 */
export const BASE_SEPOLIA_CHAIN_ID = 84532;

/** Hardhat localhost (persistent node) */
export const LOCALHOST_CHAIN_ID = 31337;

/** Base Sepolia (84532) generation v1.1 historical fallbacks — superseded June 27, 2026. */
const SEPOLIA_LEGACY = {
  karPassport: "0x6378469256907D7DC14BBfce0261ceDE22314507",
  marketplace: "0x4FC74e0B7eE0A741707A553D43Efff68126D198B",
  karProPass: "0x8e4dcb5C0b415d6c2481D72dFac6da32d9cf22C1",
  karProStaking: "0x2794015C00Da0FAf5D2451Ffba9FdD30F86dBC31",
  usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  nativeFeed: "0x4aDC67696bA383F43DD60A9e78F2C97Fbbfc7cb1",
  eurFeed: "0xb49f677943BC038e9857d61E7d053CaA2C1734C1",
} as const satisfies Record<string, `0x${string}`>;

/** Base Sepolia (84532) v2 generation deploy — June 27, 2026. Active fallbacks when env unset. Semver `-rc.1` on testnet. */
const SEPOLIA_V2 = {
  karPassport: "0x2C46B2310E2cb09b0FEeDd174D9CD3870137F594",
  marketplace: "0x9411Af4C4Ec26D939fb1AD04362456Cb41616c19",
  karProPass: "0x8e4dcb5C0b415d6c2481D72dFac6da32d9cf22C1",
  karProStaking: "0xb5d79551BB11F726D2A1A110BAc645C4345dA568",
  usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  nativeFeed: "0x4aDC67696bA383F43DD60A9e78F2C97Fbbfc7cb1",
  eurFeed: "0xb49f677943BC038e9857d61E7d053CaA2C1734C1",
  timelock: "0x9319e223ff31c954A940b14F04025B56A53ED384",
  proxyOnftAdapter: "0x59779D666747AEeDB0d9cc843cB8a68B8ab2470c",
} as const satisfies Record<string, `0x${string}`>;

type AddressKey =
  | "karPassport"
  | "marketplace"
  | "karProPass"
  | "karProStaking"
  | "usdc"
  | "nativeFeed"
  | "eurFeed";

type OptionalV2Key = "timelock" | "proxyOnftAdapter";

const ENV_SINGLE: Record<AddressKey | OptionalV2Key, string> = {
  karPassport: "NEXT_PUBLIC_KAR_PASSPORT_ADDRESS",
  marketplace: "NEXT_PUBLIC_MARKETPLACE_ADDRESS",
  karProPass: "NEXT_PUBLIC_KAR_PRO_PASS_ADDRESS",
  karProStaking: "NEXT_PUBLIC_KAR_PRO_STAKING_ADDRESS",
  usdc: "NEXT_PUBLIC_USDC_ADDRESS",
  timelock: "NEXT_PUBLIC_TIMELOCK_ADDRESS",
  proxyOnftAdapter: "NEXT_PUBLIC_PROXY_ONFT_ADAPTER_ADDRESS",
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
    return SEPOLIA_V2[key];
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
    return SEPOLIA_V2[key];
  }

  return undefined;
}

export function chainlinkNativeUsdFeed(chainId?: number): `0x${string}` | undefined {
  return resolveAddress("nativeFeed", chainId);
}

export function chainlinkEurUsdFeed(chainId?: number): `0x${string}` | undefined {
  return resolveAddress("eurFeed", chainId);
}

/** v1.1 Base Sepolia addresses — historical generation v1.x reference only. */
export const sepoliaLegacyAddresses = SEPOLIA_LEGACY;

const SEPOLIA_KARGAIN_CONTRACTS: `0x${string}`[] = [
  SEPOLIA_V2.karPassport,
  SEPOLIA_V2.marketplace,
  SEPOLIA_V2.karProPass,
  SEPOLIA_V2.karProStaking,
  SEPOLIA_V2.proxyOnftAdapter,
  SEPOLIA_LEGACY.karPassport,
  SEPOLIA_LEGACY.marketplace,
  SEPOLIA_LEGACY.karProStaking,
];

/** Kargain-owned contracts on Base Sepolia (v2 + v1.x) for profile/messaging denylist. Excludes timelock. */
export function sepoliaKargainContractDenylist(): readonly `0x${string}`[] {
  return SEPOLIA_KARGAIN_CONTRACTS;
}

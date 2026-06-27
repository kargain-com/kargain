import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getAddress } from "viem";

import type { LocalStackAddresses } from "./local-stack.js";
import type { ContractVersionName } from "./contract-versions.js";

export const LOCAL_CHAIN_ID = 31337;
export const SEPOLIA_CHAIN_ID = 84532;

export const DEPLOYMENT_PATH = join(process.cwd(), "deployments/31337.json");
export const SEPOLIA_DEPLOYMENT_PATH = join(process.cwd(), "deployments/84532.json");

/** Legacy Model X v1.1 deploy blocks (Base Sepolia, June 2026). */
export const LEGACY_SEPOLIA_BLOCKS = {
  karProPass: 42_800_433,
  karProStaking: 42_800_436,
  karPassport: 42_800_441,
  marketplaceImpl: 42_800_447,
  marketplace: 42_800_447,
} as const;

/** v1.1 Base Sepolia fallbacks — historical; superseded by v2 deploy June 27, 2026. */
export const SEPOLIA_LEGACY = {
  karPassport: "0x6378469256907D7DC14BBfce0261ceDE22314507",
  karProPass: "0x8e4dcb5C0b415d6c2481D72dFac6da32d9cf22C1",
  karProStaking: "0x2794015C00Da0FAf5D2451Ffba9FdD30F86dBC31",
  marketplace: "0x4FC74e0B7eE0A741707A553D43Efff68126D198B",
  marketplaceImpl: "0x7d37e7cbcc42308264B608429a82D03B7C3112F4",
  usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  nativeFeed: "0x4aDC67696bA383F43DD60A9e78F2C97Fbbfc7cb1",
  eurFeed: "0xb49f677943BC038e9857d61E7d053CaA2C1734C1",
  platformRecipient: "0xcfe194fea9727bD04dA8F78c2362680986e02dF1",
  deployer: "0xcf1Eb0E7ed453Ed266bF90E7C09e0E4769580b77",
  upgradeAuthority: "0xcf1Eb0E7ed453Ed266bF90E7C09e0E4769580b77",
} as const satisfies Record<string, `0x${string}`>;

/** Active v2 Base Sepolia fallbacks when no manifest / env. */
export const SEPOLIA_FALLBACK = {
  karPassport: "0x2C46B2310E2cb09b0FEeDd174D9CD3870137F594",
  karProPass: "0x8e4dcb5C0b415d6c2481D72dFac6da32d9cf22C1",
  karProStaking: "0xb5d79551BB11F726D2A1A110BAc645C4345dA568",
  marketplace: "0x9411Af4C4Ec26D939fb1AD04362456Cb41616c19",
  marketplaceImpl: "0x58d5e740B29Ab549fBD4d0A147fcDedc32E0b6a3",
  usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  nativeFeed: "0x4aDC67696bA383F43DD60A9e78F2C97Fbbfc7cb1",
  eurFeed: "0xb49f677943BC038e9857d61E7d053CaA2C1734C1",
  timelock: "0x9319e223ff31c954A940b14F04025B56A53ED384",
  proxyOnftAdapter: "0x59779D666747AEeDB0d9cc843cB8a68B8ab2470c",
  layerZeroEndpoint: "0x6EDCE65403992e310A62460808c4b910D972f10f",
  platformRecipient: "0xcfe194fea9727bD04dA8F78c2362680986e02dF1",
  deployer: "0xcf1Eb0E7ed453Ed266bF90E7C09e0E4769580b77",
  upgradeAuthority: "0x9319e223ff31c954A940b14F04025B56A53ED384",
  indexFromBlock: 43_399_242,
} as const satisfies Record<string, `0x${string}` | number>;

export type DeploymentBlocks = {
  karProPass?: number;
  karProStaking?: number;
  karPassport?: number;
  marketplaceImpl?: number;
  marketplace?: number;
};

export type DeploymentManifest = {
  chainId: number;
  generation: string;
  karPassport: `0x${string}`;
  karProPass: `0x${string}`;
  karProStaking: `0x${string}`;
  marketplace: `0x${string}`;
  marketplaceImpl: `0x${string}`;
  usdc?: `0x${string}`;
  nativeFeed?: `0x${string}`;
  eurFeed?: `0x${string}`;
  timelock?: `0x${string}`;
  platformRecipient?: `0x${string}`;
  deployer?: `0x${string}`;
  /** On-chain MarketplaceEscrow.upgradeAuthority (timelock contract or deployer EOA). */
  upgradeAuthority?: `0x${string}`;
  /** v2: LayerZero hub adapter */
  proxyOnftAdapter?: `0x${string}`;
  layerZeroEndpoint?: `0x${string}`;
  tokenIdOffset?: string;
  deployedAt: string;
  unchanged?: string[];
  blocks: DeploymentBlocks;
  indexFromBlock: number;
  txHashes?: Record<string, string>;
  contractVersions?: { [K in ContractVersionName]: string };
};

export type PonderAddressBundle = {
  karPassport: `0x${string}`;
  karProPass: `0x${string}`;
  karProStaking: `0x${string}`;
  marketplace: `0x${string}`;
  marketplaceImpl?: `0x${string}`;
};

function normalizeLocal(raw: LocalStackAddresses): LocalStackAddresses {
  return {
    ...raw,
    chainId: raw.chainId ?? LOCAL_CHAIN_ID,
    karPassport: getAddress(raw.karPassport),
    karProPass: getAddress(raw.karProPass),
    karProStaking: getAddress(raw.karProStaking),
    marketplace: getAddress(raw.marketplace),
    marketplaceImpl: getAddress(raw.marketplaceImpl),
    usdc: getAddress(raw.usdc),
    nativeFeed: getAddress(raw.nativeFeed),
    timelock: getAddress(raw.timelock),
    genesisAuthority: getAddress(raw.genesisAuthority),
    platformRecipient: getAddress(raw.platformRecipient),
  };
}

function normalizeManifest(raw: DeploymentManifest): DeploymentManifest {
  return {
    ...raw,
    chainId: raw.chainId ?? SEPOLIA_CHAIN_ID,
    karPassport: getAddress(raw.karPassport),
    karProPass: getAddress(raw.karProPass),
    karProStaking: getAddress(raw.karProStaking),
    marketplace: getAddress(raw.marketplace),
    marketplaceImpl: getAddress(raw.marketplaceImpl),
    ...(raw.usdc ? { usdc: getAddress(raw.usdc) } : {}),
    ...(raw.nativeFeed ? { nativeFeed: getAddress(raw.nativeFeed) } : {}),
    ...(raw.eurFeed ? { eurFeed: getAddress(raw.eurFeed) } : {}),
    ...(raw.deployer ? { deployer: getAddress(raw.deployer) } : {}),
    ...(raw.upgradeAuthority ? { upgradeAuthority: getAddress(raw.upgradeAuthority) } : {}),
  };
}

function readJsonFile<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return null;
  }
}

export function loadLocalDeployment(): LocalStackAddresses | null {
  const raw = readJsonFile<LocalStackAddresses>(DEPLOYMENT_PATH);
  return raw ? normalizeLocal(raw) : null;
}

export function requireLocalDeployment(): LocalStackAddresses {
  const deployment = loadLocalDeployment();
  if (!deployment) {
    throw new Error(
      "Missing deployments/31337.json — start `npx hardhat node` and run `pnpm deploy:local`",
    );
  }
  return deployment;
}

export function loadSepoliaDeployment(): DeploymentManifest | null {
  const raw = readJsonFile<DeploymentManifest>(SEPOLIA_DEPLOYMENT_PATH);
  return raw ? normalizeManifest(raw) : null;
}

export function requireSepoliaDeployment(): DeploymentManifest {
  const deployment = loadSepoliaDeployment();
  if (!deployment) {
    throw new Error(
      "Missing deployments/84532.json — run `pnpm deploy:v2` on Base Sepolia first",
    );
  }
  return deployment;
}

function ponderAddressesFromEnv(prefix: "PONDER"): PonderAddressBundle | null {
  const karPassport = process.env[`${prefix}_KAR_PASSPORT_ADDRESS`];
  const karProPass = process.env[`${prefix}_KAR_PRO_PASS_ADDRESS`];
  const karProStaking = process.env[`${prefix}_KAR_PRO_STAKING_ADDRESS`];
  const marketplace = process.env[`${prefix}_MARKETPLACE_ADDRESS`];
  if (!karPassport || !karProPass || !karProStaking || !marketplace) return null;
  return {
    karPassport: getAddress(karPassport as `0x${string}`),
    karProPass: getAddress(karProPass as `0x${string}`),
    karProStaking: getAddress(karProStaking as `0x${string}`),
    marketplace: getAddress(marketplace as `0x${string}`),
    ...(process.env[`${prefix}_MARKETPLACE_IMPL_ADDRESS`]
      ? {
          marketplaceImpl: getAddress(
            process.env[`${prefix}_MARKETPLACE_IMPL_ADDRESS`] as `0x${string}`,
          ),
        }
      : {}),
  };
}

export function ponderSepoliaAddresses(): PonderAddressBundle {
  const fromEnv = ponderAddressesFromEnv("PONDER");
  if (fromEnv) return fromEnv;

  const fromFile = loadSepoliaDeployment();
  if (fromFile) {
    return {
      karPassport: fromFile.karPassport,
      karProPass: fromFile.karProPass,
      karProStaking: fromFile.karProStaking,
      marketplace: fromFile.marketplace,
      marketplaceImpl: fromFile.marketplaceImpl,
    };
  }

  return {
    karPassport: SEPOLIA_FALLBACK.karPassport,
    karProPass: SEPOLIA_FALLBACK.karProPass,
    karProStaking: SEPOLIA_FALLBACK.karProStaking,
    marketplace: SEPOLIA_FALLBACK.marketplace,
    marketplaceImpl: SEPOLIA_FALLBACK.marketplaceImpl,
  };
}

export function ponderLocalAddresses(): LocalStackAddresses {
  const fromEnv = {
    chainId: LOCAL_CHAIN_ID,
    karPassport: process.env.PONDER_KAR_PASSPORT_ADDRESS,
    karProPass: process.env.PONDER_KAR_PRO_PASS_ADDRESS,
    karProStaking: process.env.PONDER_KAR_PRO_STAKING_ADDRESS,
    marketplace: process.env.PONDER_MARKETPLACE_ADDRESS,
    marketplaceImpl: process.env.PONDER_MARKETPLACE_IMPL_ADDRESS,
    usdc: process.env.PONDER_USDC_ADDRESS,
    nativeFeed: process.env.PONDER_NATIVE_FEED_ADDRESS,
    timelock: process.env.PONDER_TIMELOCK_ADDRESS,
    genesisAuthority: process.env.PONDER_GENESIS_AUTHORITY_ADDRESS ?? process.env.PONDER_TIMELOCK_ADDRESS,
    platformRecipient: process.env.PONDER_PLATFORM_RECIPIENT_ADDRESS,
    deployedAt: "",
  };

  const hasEnv = Boolean(fromEnv.karPassport && fromEnv.marketplace);
  if (hasEnv) {
    return normalizeLocal(fromEnv as LocalStackAddresses);
  }

  const fromFile = loadLocalDeployment();
  if (fromFile) return fromFile;

  throw new Error(
    "PONDER_ENABLE_LOCAL=1 but no addresses — run `pnpm deploy:local` or set PONDER_*_ADDRESS env vars",
  );
}

export function sepoliaBlocksForPonder(): DeploymentBlocks {
  const manifest = loadSepoliaDeployment();
  if (manifest?.blocks) return manifest.blocks;
  return { ...LEGACY_SEPOLIA_BLOCKS };
}

export function sepoliaIndexFromBlock(): number | undefined {
  const manifest = loadSepoliaDeployment();
  return manifest?.indexFromBlock;
}

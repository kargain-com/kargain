import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getAddress } from "viem";

import { SEPOLIA_ACTIVE } from "../../lib/web3/sepolia-addresses.js";
import type { LocalStackAddresses } from "./local-stack.js";
import type { ContractVersionName } from "./contract-versions.js";

export const LOCAL_CHAIN_ID = 31337;
export const SEPOLIA_CHAIN_ID = 84532;

export const DEPLOYMENT_PATH = join(process.cwd(), "deployments/31337.json");
export const SEPOLIA_DEPLOYMENT_PATH = join(process.cwd(), "deployments/84532.json");

/** Active Base Sepolia fallbacks when no manifest / env. Re-export from lib/web3/sepolia-addresses.ts */
export const SEPOLIA_FALLBACK = SEPOLIA_ACTIVE;

export type DeploymentBlocks = {
  karProPass?: number;
  karProStaking?: number;
  karPassport?: number;
  marketplaceImpl?: number;
  marketplace?: number;
  timelock?: number;
  proxyOnftAdapter?: number;
  auctionEscrow?: number;
  auctionEscrowImpl?: number;
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
  /** English reserve auction escrow (additive deploy) */
  auctionEscrow?: `0x${string}`;
  auctionEscrowImpl?: `0x${string}`;
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
  auctionEscrow?: `0x${string}`;
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
    ...(raw.auctionEscrow ? { auctionEscrow: getAddress(raw.auctionEscrow) } : {}),
    ...(raw.auctionEscrowImpl ? { auctionEscrowImpl: getAddress(raw.auctionEscrowImpl) } : {}),
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
      "Missing deployments/84532.json — run `pnpm deploy:sepolia` on Base Sepolia first",
    );
  }
  return deployment;
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

export {
  ponderSepoliaAddresses,
  sepoliaBlocksForPonder,
  sepoliaIndexFromBlock,
} from "./resolve-sepolia-stack.js";

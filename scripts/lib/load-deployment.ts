import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getAddress } from "viem";

import { SEPOLIA_ACTIVE } from "../../lib/web3/sepolia-addresses.js";
import type { LocalStackAddresses } from "./local-stack.js";
import type { ContractVersionName } from "./contract-versions.js";

export const LOCAL_CHAIN_ID = 31337;
export const SEPOLIA_CHAIN_ID = 84532;
export const SPOKE_CHAIN_ID = 11155111;

export const DEPLOYMENT_PATH = join(process.cwd(), "deployments/31337.json");
export const SEPOLIA_DEPLOYMENT_PATH = join(process.cwd(), "deployments/84532.json");
export const SPOKE_DEPLOYMENT_PATH = join(process.cwd(), "deployments/11155111.json");

/** Hub commercial manifests — Base Sepolia (84532) and Ethereum Sepolia (11155111). */
export function commercialDeploymentPath(chainId: number): string {
  return join(process.cwd(), `deployments/${chainId}.json`);
}

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

/** Prior hub adapter address retained when `pnpm deploy:adapter:sepolia` overwrites. */
export type HistoricalProxyOnftAdapter = {
  address: `0x${string}`;
  block?: number;
  txHash?: string;
  version?: string;
  replacedAt: string;
};

export type DeploymentHistorical = {
  proxyOnftAdapter?: HistoricalProxyOnftAdapter[];
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
  /** Replaced addresses kept for ops (adapter redeploy). */
  historical?: DeploymentHistorical;
  blocks: DeploymentBlocks;
  indexFromBlock: number;
  txHashes?: Record<string, string>;
  contractVersions?: { [K in ContractVersionName]: string };
};

/** Hub↔spoke peer bookkeeping written by `pnpm bridge:wire` on successful full wire. */
export type SpokePathwayPeers = {
  hubEid: 40245;
  spokeEid: 40161;
  hubOApp: `0x${string}`;
  spokeOApp: `0x${string}`;
};

/** Ethereum Sepolia spoke ONFT — peers/pathwayConfigHash filled by wiring iteration. */
export type SpokeDeploymentManifest = {
  chainId: typeof SPOKE_CHAIN_ID;
  gitCommit: string;
  contractVersions: { KarPassportONFT721: string };
  karPassportOnft: `0x${string}`;
  layerZeroEndpoint: `0x${string}`;
  /** Delegate passed to KarPassportONFT721 constructor — needed for explorer verify. */
  deployer: `0x${string}`;
  blocks: { karPassportOnft: number };
  peers: SpokePathwayPeers | null;
  pathwayConfigHash: `0x${string}` | null;
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
    ...(raw.auctionEscrow ? { auctionEscrow: getAddress(raw.auctionEscrow) } : {}),
    ...(raw.auctionEscrowImpl
      ? { auctionEscrowImpl: getAddress(raw.auctionEscrowImpl) }
      : {}),
  };
}

function normalizeHistorical(
  historical: DeploymentHistorical | undefined,
): DeploymentHistorical | undefined {
  if (!historical) return undefined;
  const adapters = historical.proxyOnftAdapter;
  if (!adapters) return historical;
  return {
    ...historical,
    proxyOnftAdapter: adapters.map((entry) => ({
      ...entry,
      address: getAddress(entry.address),
    })),
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
    ...(raw.proxyOnftAdapter ? { proxyOnftAdapter: getAddress(raw.proxyOnftAdapter) } : {}),
    ...(raw.layerZeroEndpoint ? { layerZeroEndpoint: getAddress(raw.layerZeroEndpoint) } : {}),
    ...(raw.historical ? { historical: normalizeHistorical(raw.historical) } : {}),
  };
}

function normalizeSpokePeers(
  peers: SpokePathwayPeers | null | undefined,
): SpokePathwayPeers | null {
  if (peers == null) return null;
  return {
    hubEid: 40245,
    spokeEid: 40161,
    hubOApp: getAddress(peers.hubOApp),
    spokeOApp: getAddress(peers.spokeOApp),
  };
}

function normalizeSpokeManifest(raw: SpokeDeploymentManifest): SpokeDeploymentManifest {
  return {
    ...raw,
    chainId: SPOKE_CHAIN_ID,
    karPassportOnft: getAddress(raw.karPassportOnft),
    layerZeroEndpoint: getAddress(raw.layerZeroEndpoint),
    deployer: getAddress(raw.deployer),
    peers: normalizeSpokePeers(raw.peers),
    pathwayConfigHash: raw.pathwayConfigHash ?? null,
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

export function loadCommercialDeployment(chainId: number): DeploymentManifest | null {
  const raw = readJsonFile<DeploymentManifest>(commercialDeploymentPath(chainId));
  return raw ? normalizeManifest(raw) : null;
}

export function requireCommercialDeployment(chainId: number): DeploymentManifest {
  const deployment = loadCommercialDeployment(chainId);
  if (!deployment) {
    throw new Error(
      `Missing deployments/${chainId}.json — run nuclear deploy on chain ${chainId} first`,
    );
  }
  return deployment;
}

export function loadSpokeDeployment(): SpokeDeploymentManifest | null {
  const raw = readJsonFile<SpokeDeploymentManifest>(SPOKE_DEPLOYMENT_PATH);
  return raw ? normalizeSpokeManifest(raw) : null;
}

export function requireSpokeDeployment(): SpokeDeploymentManifest {
  const deployment = loadSpokeDeployment();
  if (!deployment) {
    throw new Error(
      "Missing deployments/11155111.json — run `pnpm deploy:spoke:sepolia` on Ethereum Sepolia first",
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
    ...(process.env.PONDER_AUCTION_ESCROW_ADDRESS
      ? { auctionEscrow: process.env.PONDER_AUCTION_ESCROW_ADDRESS as `0x${string}` }
      : {}),
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

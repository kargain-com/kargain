import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getAddress } from "viem";

import { SEPOLIA_ACTIVE } from "../../lib/web3/sepolia-addresses.js";
import type { LocalStackAddresses } from "./local-stack.js";
import type { ContractVersionName } from "./contract-versions.js";

export const LOCAL_CHAIN_ID = 31337;
export const SEPOLIA_CHAIN_ID = 84532;
export const SPOKE_CHAIN_ID = 11155111;

/**
 * Sole deployments directory resolver.
 * `KARGAIN_DEPLOYMENTS_DIR` — test/tooling override; empty/unset → `<cwd>/deployments`.
 * No production/VPS role.
 */
export function deploymentsDirectory(): string {
  const override = process.env.KARGAIN_DEPLOYMENTS_DIR?.trim();
  if (override) return override;
  return join(process.cwd(), "deployments");
}

/** Manifest path for a chain — sole join of directory + `{chainId}.json`. */
export function deploymentPathForChain(chainId: number): string {
  return join(deploymentsDirectory(), `${chainId}.json`);
}

/** Alias of {@link deploymentPathForChain} (commercial hub/spoke manifests). */
export const commercialDeploymentPath = deploymentPathForChain;

/** Live path to `31337.json` — re-reads `KARGAIN_DEPLOYMENTS_DIR` / cwd. */
export function DEPLOYMENT_PATH(): string {
  return deploymentPathForChain(LOCAL_CHAIN_ID);
}
/** Live path to `84532.json`. */
export function SEPOLIA_DEPLOYMENT_PATH(): string {
  return deploymentPathForChain(SEPOLIA_CHAIN_ID);
}
/** Live path to `11155111.json`. */
export function SPOKE_DEPLOYMENT_PATH(): string {
  return deploymentPathForChain(SPOKE_CHAIN_ID);
}

/** Active Base Sepolia fallbacks when no manifest / env. Re-export from lib/web3/sepolia-addresses.ts */
export const SEPOLIA_FALLBACK = SEPOLIA_ACTIVE;

export type DeploymentBlocks = {
  karProPass?: number;
  karProStaking?: number;
  karPassport?: number;
  timelock?: number;
  bridgeGateway?: number;
  fixedPriceConsignment?: number;
  fixedPriceConsignmentImpl?: number;
  ascendingHoldLib?: number;
  ascendingOpenLib?: number;
  ascendingConsignment?: number;
  ascendingConsignmentImpl?: number;
};

/** Prior hub gateway address retained when gateway is redeployed. */
export type HistoricalBridgeGateway = {
  address: `0x${string}`;
  block?: number;
  txHash?: string;
  version?: string;
  replacedAt: string;
};

export type DeploymentHistorical = {
  bridgeGateway?: HistoricalBridgeGateway[];
};

/** Hub↔spoke peer bookkeeping written by `pnpm bridge:wire` on successful full wire. */
export type SpokePathwayPeers = {
  hubEid: 40245;
  spokeEid: 40161;
  hubOApp: `0x${string}`;
  spokeOApp: `0x${string}`;
};

export type DeploymentManifest = {
  chainId: number;
  generation: string;
  karPassport: `0x${string}`;
  karProPass: `0x${string}`;
  karProStaking: `0x${string}`;
  usdc?: `0x${string}`;
  nativeFeed?: `0x${string}`;
  eurFeed?: `0x${string}`;
  timelock?: `0x${string}`;
  platformRecipient?: `0x${string}`;
  /** Forfeit sink — passport ctor + Ascending BondedChallenge (distinct from fee sink). */
  forfeitRecipient?: `0x${string}`;
  deployer?: `0x${string}`;
  /** Timelock or deployer EOA recorded as manifest upgradeAuthority (historical manifests). */
  upgradeAuthority?: `0x${string}`;
  /** KarPassportBridgeGateway (nuclear commercial stack) */
  bridgeGateway?: `0x${string}`;
  /** Commerce modes (UUPS; G3 guardian) */
  fixedPriceConsignment?: `0x${string}`;
  fixedPriceConsignmentImpl?: `0x${string}`;
  /** Linked Ascending libraries (deploy before AscendingConsignment impl). */
  ascendingHoldLib?: `0x${string}`;
  ascendingOpenLib?: `0x${string}`;
  ascendingConsignment?: `0x${string}`;
  ascendingConsignmentImpl?: `0x${string}`;
  /** G3 pause guardian (EOA or multisig); not the timelock */
  commerceGuardian?: `0x${string}`;
  layerZeroEndpoint?: `0x${string}`;
  tokenIdOffset?: string;
  deployedAt: string;
  unchanged?: string[];
  /** Replaced addresses kept for ops (gateway redeploy). */
  historical?: DeploymentHistorical;
  blocks: DeploymentBlocks;
  indexFromBlock: number;
  txHashes?: Record<string, string>;
  contractVersions?: { [K in ContractVersionName]: string };
  /**
   * Hardhat build-info id + sha256 of `deployments/{chainId}.build-info.json`
   * (deploy-time solc input). Bound via {@link deploymentsDirectory}.
   */
  buildInfoId?: string;
  buildInfoSha256?: string;
  /** SHA-256 of each nuclear artifact `deployedBytecode` at deploy (hex of 0x…). */
  artifactDigests?: Record<string, string>;
  /** Git HEAD at live deploy (refuse dirty tree). */
  deployGitHead?: string;
  /** Hub↔spoke peers written by `pnpm bridge:wire` on successful full wire (nuclear eth stack). */
  peers?: SpokePathwayPeers | null;
  pathwayConfigHash?: `0x${string}` | null;
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
  /** Commerce modes — filled at Nuclear #2; absent until then. */
  fixedPriceConsignment?: `0x${string}`;
  ascendingConsignment?: `0x${string}`;
};

function normalizeLocal(raw: LocalStackAddresses): LocalStackAddresses {
  return {
    ...raw,
    chainId: raw.chainId ?? LOCAL_CHAIN_ID,
    karPassport: getAddress(raw.karPassport),
    karProPass: getAddress(raw.karProPass),
    karProStaking: getAddress(raw.karProStaking),
    usdc: getAddress(raw.usdc),
    nativeFeed: getAddress(raw.nativeFeed),
    timelock: getAddress(raw.timelock),
    platformRecipient: getAddress(raw.platformRecipient),
    ...(raw.fixedPriceConsignment
      ? { fixedPriceConsignment: getAddress(raw.fixedPriceConsignment) }
      : {}),
    ...(raw.fixedPriceConsignmentImpl
      ? { fixedPriceConsignmentImpl: getAddress(raw.fixedPriceConsignmentImpl) }
      : {}),
    ...(raw.ascendingHoldLib ? { ascendingHoldLib: getAddress(raw.ascendingHoldLib) } : {}),
    ...(raw.ascendingOpenLib ? { ascendingOpenLib: getAddress(raw.ascendingOpenLib) } : {}),
    ...(raw.ascendingConsignment
      ? { ascendingConsignment: getAddress(raw.ascendingConsignment) }
      : {}),
    ...(raw.ascendingConsignmentImpl
      ? { ascendingConsignmentImpl: getAddress(raw.ascendingConsignmentImpl) }
      : {}),
    ...(raw.commercePayoutSink
      ? { commercePayoutSink: getAddress(raw.commercePayoutSink) }
      : {}),
  };
}

function normalizeHistorical(
  historical: DeploymentHistorical | undefined,
): DeploymentHistorical | undefined {
  if (!historical) return undefined;
  const gateways = historical.bridgeGateway;
  if (!gateways) return historical;
  return {
    ...historical,
    bridgeGateway: gateways.map((entry) => ({
      ...entry,
      address: getAddress(entry.address),
    })),
  };
}

function isCommercialManifestShape(raw: unknown): raw is DeploymentManifest {
  return (
    typeof raw === "object" &&
    raw !== null &&
    typeof (raw as { karPassport?: unknown }).karPassport === "string"
  );
}

function isThinOnftSpokeManifestShape(raw: unknown): raw is SpokeDeploymentManifest {
  return (
    typeof raw === "object" &&
    raw !== null &&
    typeof (raw as { karPassportOnft?: unknown }).karPassportOnft === "string"
  );
}

function normalizeManifest(raw: DeploymentManifest): DeploymentManifest {
  return {
    ...raw,
    chainId: raw.chainId ?? SEPOLIA_CHAIN_ID,
    karPassport: getAddress(raw.karPassport),
    karProPass: getAddress(raw.karProPass),
    karProStaking: getAddress(raw.karProStaking),
    ...(raw.usdc ? { usdc: getAddress(raw.usdc) } : {}),
    ...(raw.nativeFeed ? { nativeFeed: getAddress(raw.nativeFeed) } : {}),
    ...(raw.eurFeed ? { eurFeed: getAddress(raw.eurFeed) } : {}),
    ...(raw.deployer ? { deployer: getAddress(raw.deployer) } : {}),
    ...(raw.upgradeAuthority ? { upgradeAuthority: getAddress(raw.upgradeAuthority) } : {}),
    ...(raw.fixedPriceConsignment
      ? { fixedPriceConsignment: getAddress(raw.fixedPriceConsignment) }
      : {}),
    ...(raw.fixedPriceConsignmentImpl
      ? { fixedPriceConsignmentImpl: getAddress(raw.fixedPriceConsignmentImpl) }
      : {}),
    ...(raw.ascendingHoldLib ? { ascendingHoldLib: getAddress(raw.ascendingHoldLib) } : {}),
    ...(raw.ascendingOpenLib ? { ascendingOpenLib: getAddress(raw.ascendingOpenLib) } : {}),
    ...(raw.ascendingConsignment
      ? { ascendingConsignment: getAddress(raw.ascendingConsignment) }
      : {}),
    ...(raw.ascendingConsignmentImpl
      ? { ascendingConsignmentImpl: getAddress(raw.ascendingConsignmentImpl) }
      : {}),
    ...(raw.commerceGuardian ? { commerceGuardian: getAddress(raw.commerceGuardian) } : {}),
    ...(raw.platformRecipient ? { platformRecipient: getAddress(raw.platformRecipient) } : {}),
    ...(raw.forfeitRecipient ? { forfeitRecipient: getAddress(raw.forfeitRecipient) } : {}),
    ...(raw.bridgeGateway ? { bridgeGateway: getAddress(raw.bridgeGateway) } : {}),
    ...(raw.layerZeroEndpoint ? { layerZeroEndpoint: getAddress(raw.layerZeroEndpoint) } : {}),
    ...(raw.historical ? { historical: normalizeHistorical(raw.historical) } : {}),
    ...(raw.peers !== undefined ? { peers: normalizeSpokePeers(raw.peers) } : {}),
    ...(raw.pathwayConfigHash !== undefined
      ? { pathwayConfigHash: raw.pathwayConfigHash }
      : {}),
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
  const raw = readJsonFile<LocalStackAddresses>(DEPLOYMENT_PATH());
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
  const raw = readJsonFile<DeploymentManifest>(SEPOLIA_DEPLOYMENT_PATH());
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
  const raw = readJsonFile<unknown>(commercialDeploymentPath(chainId));
  if (!isCommercialManifestShape(raw)) return null;
  return normalizeManifest(raw);
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
  const raw = readJsonFile<unknown>(SPOKE_DEPLOYMENT_PATH());
  if (!isThinOnftSpokeManifestShape(raw)) return null;
  return normalizeSpokeManifest(raw);
}

export function ponderLocalAddresses(): LocalStackAddresses {
  const fromEnv = {
    chainId: LOCAL_CHAIN_ID,
    karPassport: process.env.PONDER_KAR_PASSPORT_ADDRESS,
    karProPass: process.env.PONDER_KAR_PRO_PASS_ADDRESS,
    karProStaking: process.env.PONDER_KAR_PRO_STAKING_ADDRESS,
    usdc: process.env.PONDER_USDC_ADDRESS,
    nativeFeed: process.env.PONDER_NATIVE_FEED_ADDRESS,
    timelock: process.env.PONDER_TIMELOCK_ADDRESS,
    platformRecipient: process.env.PONDER_PLATFORM_RECIPIENT_ADDRESS,
    ...(process.env.PONDER_FIXED_PRICE_CONSIGNMENT_ADDRESS
      ? {
          fixedPriceConsignment: process.env
            .PONDER_FIXED_PRICE_CONSIGNMENT_ADDRESS as `0x${string}`,
        }
      : {}),
    ...(process.env.PONDER_ASCENDING_CONSIGNMENT_ADDRESS
      ? {
          ascendingConsignment: process.env
            .PONDER_ASCENDING_CONSIGNMENT_ADDRESS as `0x${string}`,
        }
      : {}),
    deployedAt: "",
  };

  const hasEnv = Boolean(fromEnv.karPassport);
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
  ponderAddressesFromStack,
  ponderCommercialAddresses,
  ponderSepoliaAddresses,
  resolveCommercialStack,
  sepoliaBlocksForPonder,
  sepoliaIndexFromBlock,
} from "./resolve-sepolia-stack.js";

/** Solana Devnet deploy evidence — `deployments/svm-{eid}.json` (gitignored). */
export type SvmDevnetProgramEvidence = {
  programId: string;
  soSha256?: string;
  soBytes?: number;
  upgradeAuthority?: string;
};

export type SvmDevnetPathwayPeers = {
  hubEid: 40245;
  spokeEid: 40168;
  hubOApp: `0x${string}`;
  spokeOApp: string;
};

export type SvmDevnetEvidence = {
  cluster: string;
  eid: number;
  namespace: number;
  programs: {
    kar_passport: SvmDevnetProgramEvidence;
    kar_gateway: SvmDevnetProgramEvidence;
    mock_staking?: SvmDevnetProgramEvidence;
    kar_pro_staking?: SvmDevnetProgramEvidence;
    kar_pro_pass?: SvmDevnetProgramEvidence;
  };
  /** S5 — ETH weight → lamports pin at deploy (join never quotes FX). */
  minStakePin?: {
    ethWeightWei: string;
    ethFloorWei: string;
    solLamports: string;
    floorLamports: string;
    solPerEth: string;
    rateDate: string;
    source: string;
  } | null;
  peers?: SvmDevnetPathwayPeers | null;
  pathwayConfigHash?: `0x${string}` | null;
  [key: string]: unknown;
};

export function svmDevnetEvidencePath(eid: number = 40168): string {
  return join(deploymentsDirectory(), `svm-${eid}.json`);
}

export function loadSvmDevnetEvidence(eid: number = 40168): SvmDevnetEvidence | null {
  return readJsonFile<SvmDevnetEvidence>(svmDevnetEvidencePath(eid));
}

export function requireSvmDevnetEvidence(eid: number = 40168): SvmDevnetEvidence {
  const evidence = loadSvmDevnetEvidence(eid);
  if (!evidence?.programs?.kar_gateway?.programId) {
    throw new Error(
      `Missing SVM deploy evidence ${svmDevnetEvidencePath(eid)} (run pnpm deploy:svm)`,
    );
  }
  return evidence;
}

/** Map a commercial deployment manifest to the Ponder address bundle. */
export function ponderAddressesFromCommercialManifest(
  manifest: DeploymentManifest,
): PonderAddressBundle {
  return {
    karPassport: manifest.karPassport,
    karProPass: manifest.karProPass,
    karProStaking: manifest.karProStaking,
    ...(manifest.fixedPriceConsignment
      ? { fixedPriceConsignment: manifest.fixedPriceConsignment }
      : {}),
    ...(manifest.ascendingConsignment
      ? { ascendingConsignment: manifest.ascendingConsignment }
      : {}),
  };
}

import { getAddress } from "viem";

import {
  isCommercialEip155Id,
  requireCommercialActive,
  requireEvmCommercialActive,
  type EvmCommercialActiveStack,
} from "../../lib/web3/commercial-active.js";
import {
  ETHEREUM_SEPOLIA_PUBLIC_RPC,
  SEPOLIA_PUBLIC_RPC,
} from "../../lib/web3/sepolia-addresses.js";
import type {
  DeploymentBlocks,
  DeploymentManifest,
  PonderAddressBundle,
} from "./load-deployment.js";
import {
  commercialDeploymentPath,
  loadCommercialDeployment,
  loadSepoliaDeployment,
  SEPOLIA_CHAIN_ID as HUB_CHAIN_ID,
  SEPOLIA_DEPLOYMENT_PATH,
  SPOKE_CHAIN_ID,
} from "./load-deployment.js";

export type CommercialStackSource = "env" | "manifest" | "committed";

export type ResolvedCommercialStack = {
  source: CommercialStackSource;
  chainId: number;
  generation: string;
  karPassport: `0x${string}`;
  karProPass: `0x${string}`;
  karProStaking: `0x${string}`;
  usdc: `0x${string}`;
  nativeFeed: `0x${string}`;
  timelock?: `0x${string}`;
  bridgeGateway?: `0x${string}`;
  /** Commerce modes — filled at Nuclear #2; absent until then. */
  fixedPriceConsignment?: `0x${string}`;
  ascendingConsignment?: `0x${string}`;
  indexFromBlock: number;
  blocks: DeploymentBlocks;
};

const CORE_ENV_KEYS = [
  "PONDER_KAR_PASSPORT_ADDRESS",
  "PONDER_KAR_PRO_PASS_ADDRESS",
  "PONDER_KAR_PRO_STAKING_ADDRESS",
] as const;

function parseStartBlockEnv(chainId: number): number | undefined {
  const specificKey =
    chainId === HUB_CHAIN_ID
      ? "PONDER_START_BLOCK_84532"
      : chainId === SPOKE_CHAIN_ID
        ? "PONDER_START_BLOCK_11155111"
        : undefined;
  const raw =
    (specificKey ? process.env[specificKey]?.trim() : undefined) ||
    (chainId === HUB_CHAIN_ID ? process.env.PONDER_START_BLOCK?.trim() : undefined);
  if (!raw || raw === "latest") return undefined;
  const block = Number.parseInt(raw, 10);
  if (!Number.isFinite(block) || block < 0) return undefined;
  return block;
}

function stackFromCommitted(chainId: number): ResolvedCommercialStack {
  if (!isCommercialEip155Id(chainId)) {
    throw new Error(
      `stackFromCommitted: chain ${chainId} is not a committed EVM commercial stack`,
    );
  }
  const active = requireEvmCommercialActive(chainId);
  return {
    source: "committed",
    chainId,
    generation: "v2",
    karPassport: active.karPassport,
    karProPass: active.karProPass,
    karProStaking: active.karProStaking,
    usdc: active.usdc,
    nativeFeed: active.nativeFeed,
    timelock: active.timelock,
    bridgeGateway: active.bridgeGateway,
    ...(active.fixedPriceConsignment
      ? { fixedPriceConsignment: active.fixedPriceConsignment }
      : {}),
    ...(active.ascendingConsignment
      ? { ascendingConsignment: active.ascendingConsignment }
      : {}),
    indexFromBlock: active.indexFromBlock,
    blocks: { ...active.blocks },
  };
}

function stackFromManifest(
  manifest: DeploymentManifest,
  source: CommercialStackSource,
  committed: EvmCommercialActiveStack,
): ResolvedCommercialStack {
  return {
    source,
    chainId: manifest.chainId,
    generation: manifest.generation,
    karPassport: manifest.karPassport,
    karProPass: manifest.karProPass,
    karProStaking: manifest.karProStaking,
    usdc: manifest.usdc ?? committed.usdc,
    nativeFeed: manifest.nativeFeed ?? committed.nativeFeed,
    ...(manifest.timelock ? { timelock: manifest.timelock } : {}),
    ...(manifest.bridgeGateway ? { bridgeGateway: manifest.bridgeGateway } : {}),
    ...(manifest.fixedPriceConsignment
      ? { fixedPriceConsignment: manifest.fixedPriceConsignment }
      : {}),
    ...(manifest.ascendingConsignment
      ? { ascendingConsignment: manifest.ascendingConsignment }
      : {}),
    indexFromBlock: manifest.indexFromBlock,
    blocks: manifest.blocks,
  };
}

/**
 * Debug overrides for hub (84532) only — all three core PONDER_* addresses required.
 * Do not invent per-chain env maps here; Eth uses manifest → committed.
 */
function stackFromEnv84532(): ResolvedCommercialStack | null {
  const karPassport = process.env.PONDER_KAR_PASSPORT_ADDRESS;
  const karProPass = process.env.PONDER_KAR_PRO_PASS_ADDRESS;
  const karProStaking = process.env.PONDER_KAR_PRO_STAKING_ADDRESS;
  if (!karPassport || !karProPass || !karProStaking) return null;

  const committed = requireEvmCommercialActive(HUB_CHAIN_ID);
  const manifest = loadSepoliaDeployment();
  const base = manifest
    ? stackFromManifest(manifest, "env", committed)
    : stackFromCommitted(HUB_CHAIN_ID);

  const indexFromBlock = parseStartBlockEnv(HUB_CHAIN_ID) ?? base.indexFromBlock;

  return {
    ...base,
    source: "env",
    karPassport: getAddress(karPassport as `0x${string}`),
    karProPass: getAddress(karProPass as `0x${string}`),
    karProStaking: getAddress(karProStaking as `0x${string}`),
    usdc: process.env.PONDER_USDC_ADDRESS
      ? getAddress(process.env.PONDER_USDC_ADDRESS as `0x${string}`)
      : base.usdc,
    nativeFeed: process.env.PONDER_NATIVE_FEED_ADDRESS
      ? getAddress(process.env.PONDER_NATIVE_FEED_ADDRESS as `0x${string}`)
      : base.nativeFeed,
    fixedPriceConsignment: process.env.PONDER_FIXED_PRICE_CONSIGNMENT_ADDRESS
      ? getAddress(process.env.PONDER_FIXED_PRICE_CONSIGNMENT_ADDRESS as `0x${string}`)
      : base.fixedPriceConsignment,
    ascendingConsignment: process.env.PONDER_ASCENDING_CONSIGNMENT_ADDRESS
      ? getAddress(process.env.PONDER_ASCENDING_CONSIGNMENT_ADDRESS as `0x${string}`)
      : base.ascendingConsignment,
    indexFromBlock,
  };
}

export function ponderAddressesFromStack(stack: ResolvedCommercialStack): PonderAddressBundle {
  return {
    karPassport: stack.karPassport,
    karProPass: stack.karProPass,
    karProStaking: stack.karProStaking,
    ...(stack.fixedPriceConsignment
      ? { fixedPriceConsignment: stack.fixedPriceConsignment }
      : {}),
    ...(stack.ascendingConsignment
      ? { ascendingConsignment: stack.ascendingConsignment }
      : {}),
    ...(stack.bridgeGateway ? { bridgeGateway: stack.bridgeGateway } : {}),
  };
}

/**
 * Uniform commercial resolver: optional env (84532) → deployments/<chainId>.json → COMMERCIAL_ACTIVE.
 */
export function resolveCommercialStack(chainId: number): ResolvedCommercialStack {
  if (chainId === HUB_CHAIN_ID) {
    const fromEnv = stackFromEnv84532();
    if (fromEnv) return fromEnv;
  }

  if (!isCommercialEip155Id(chainId)) {
    requireCommercialActive(chainId);
    throw new Error(`resolveCommercialStack: unreachable after requireCommercialActive(${chainId})`);
  }
  const committed = requireEvmCommercialActive(chainId);
  const manifest = loadCommercialDeployment(chainId);
  if (manifest) return stackFromManifest(manifest, "manifest", committed);

  return stackFromCommitted(chainId);
}

/** Hub convenience — same as resolveCommercialStack(84532). */
export function resolveSepoliaStack(): ResolvedCommercialStack {
  return resolveCommercialStack(HUB_CHAIN_ID);
}

export function ponderSepoliaAddresses(): PonderAddressBundle {
  return ponderAddressesFromStack(resolveSepoliaStack());
}

export function ponderCommercialAddresses(chainId: number): {
  addresses: PonderAddressBundle;
  blocks: DeploymentBlocks;
  indexFromBlock: number;
  source: CommercialStackSource;
} {
  const stack = resolveCommercialStack(chainId);
  return {
    addresses: ponderAddressesFromStack(stack),
    blocks: stack.blocks,
    indexFromBlock: stack.indexFromBlock,
    source: stack.source,
  };
}

export function sepoliaBlocksForPonder(): DeploymentBlocks {
  return resolveSepoliaStack().blocks;
}

export function sepoliaIndexFromBlock(): number {
  return resolveSepoliaIndexFromBlock();
}

export function resolveSepoliaIndexFromBlock(): number {
  return parseStartBlockEnv(HUB_CHAIN_ID) ?? resolveSepoliaStack().indexFromBlock;
}

export function resolveSepoliaBlocksForPonder(): DeploymentBlocks {
  return resolveSepoliaStack().blocks;
}

type AddressField = keyof Pick<
  ResolvedCommercialStack,
  "karPassport" | "karProPass" | "karProStaking"
>;

const COMPARE_FIELDS: AddressField[] = ["karPassport", "karProPass", "karProStaking"];

/** Warn when local manifest diverges from committed fallbacks (common VPS drift). */
export function manifestCommittedDrift(chainId: number = HUB_CHAIN_ID): string[] {
  const manifest = loadCommercialDeployment(chainId);
  if (!manifest) return [];

  const committed = stackFromCommitted(chainId);
  const warnings: string[] = [];
  const path = commercialDeploymentPath(chainId);

  for (const field of COMPARE_FIELDS) {
    const a = manifest[field].toLowerCase();
    const b = committed[field].toLowerCase();
    if (a !== b) {
      warnings.push(
        `${field}: manifest ${manifest[field]} ≠ committed ${committed[field]} — git pull or remove stale ${path}`,
      );
    }
  }

  if (manifest.indexFromBlock !== committed.indexFromBlock) {
    warnings.push(
      `indexFromBlock: manifest ${manifest.indexFromBlock} ≠ committed ${committed.indexFromBlock}`,
    );
  }

  return warnings;
}

export function formatSepoliaStackReport(stack: ResolvedCommercialStack): string {
  const eth = resolveCommercialStack(SPOKE_CHAIN_ID);
  const lines: string[] = [
    "Kargain commercial stacks",
    "=========================",
    "",
    `Base Sepolia (84532) — source: ${stack.source}`,
    `  Generation:     ${stack.generation}`,
    `  indexFromBlock: ${stack.indexFromBlock}`,
    `  karPassport:    ${stack.karPassport}`,
    `  fixedPrice:     ${stack.fixedPriceConsignment ?? "(none — Nuclear #2)"}`,
    `  ascending:      ${stack.ascendingConsignment ?? "(none — Nuclear #2)"}`,
    `  gateway:        ${stack.bridgeGateway ?? "(none)"}`,
    "",
    `Ethereum Sepolia (11155111) — source: ${eth.source}`,
    `  indexFromBlock: ${eth.indexFromBlock}`,
    `  karPassport:    ${eth.karPassport}`,
    `  fixedPrice:     ${eth.fixedPriceConsignment ?? "(none — Nuclear #2)"}`,
    `  ascending:      ${eth.ascendingConsignment ?? "(none — Nuclear #2)"}`,
    `  gateway:        ${eth.bridgeGateway ?? "(none)"}`,
    "",
    "Network (VPS — see .env.example):",
    `  PONDER_RPC_URL_84532=${process.env.PONDER_RPC_URL_84532 ?? SEPOLIA_PUBLIC_RPC}`,
    `  PONDER_RPC_URL_11155111=${process.env.PONDER_RPC_URL_11155111 ?? ETHEREUM_SEPOLIA_PUBLIC_RPC}`,
    `  PONDER_START_BLOCK_84532=${stack.indexFromBlock}`,
    `  PONDER_START_BLOCK_11155111=${eth.indexFromBlock}`,
    `  NEXT_PUBLIC_RPC_BY_CHAIN={"84532":"${SEPOLIA_PUBLIC_RPC}","11155111":"${ETHEREUM_SEPOLIA_PUBLIC_RPC}"}`,
    "",
  ];

  const drift = [
    ...manifestCommittedDrift(HUB_CHAIN_ID),
    ...manifestCommittedDrift(SPOKE_CHAIN_ID),
  ];
  if (drift.length > 0) {
    lines.push("Warnings (manifest vs committed in git):");
    for (const w of drift) lines.push(`  ⚠ ${w}`);
    lines.push("");
  }

  if (stack.source === "committed" && eth.source === "committed") {
    lines.push(
      "Addresses: COMMERCIAL_ACTIVE in lib/web3/commercial-active.ts (git pull + rebuild).",
      "No PONDER_*_ADDRESS or deployments/*.json required on VPS.",
    );
  } else {
    if (stack.source === "env") {
      lines.push(`Hub using PONDER_* env overrides (${CORE_ENV_KEYS.join(", ")}).`);
    }
    if (stack.source === "manifest") {
      lines.push(`Hub using ${SEPOLIA_DEPLOYMENT_PATH()} on disk.`);
    }
    if (eth.source === "manifest") {
      lines.push(`Eth using ${commercialDeploymentPath(SPOKE_CHAIN_ID)} on disk.`);
    }
    lines.push(
      "After Nuclear cutover: update COMMERCIAL_ACTIVE + SPEC I.9.x in the same PR, then git pull on VPS.",
    );
  }

  lines.push(
    "",
    "Reindex: docs/indexer/OPERATIONS.md",
    "  ./scripts/ponder-reindex.sh && docker compose up -d --force-recreate ponder",
  );

  return lines.join("\n");
}

export { HUB_CHAIN_ID as SEPOLIA_CHAIN_ID, CORE_ENV_KEYS };

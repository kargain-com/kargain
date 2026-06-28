import { getAddress } from "viem";

import {
  SEPOLIA_ACTIVE,
  SEPOLIA_CHAIN_ID,
  SEPOLIA_PUBLIC_RPC,
} from "../../lib/web3/sepolia-addresses.js";
import type {
  DeploymentBlocks,
  DeploymentManifest,
  PonderAddressBundle,
} from "./load-deployment.js";
import { loadSepoliaDeployment, SEPOLIA_DEPLOYMENT_PATH } from "./load-deployment.js";

export type SepoliaStackSource = "env" | "manifest" | "committed";

export type ResolvedSepoliaStack = {
  source: SepoliaStackSource;
  chainId: number;
  generation: string;
  karPassport: `0x${string}`;
  karProPass: `0x${string}`;
  karProStaking: `0x${string}`;
  marketplace: `0x${string}`;
  marketplaceImpl: `0x${string}`;
  usdc: `0x${string}`;
  nativeFeed: `0x${string}`;
  timelock?: `0x${string}`;
  proxyOnftAdapter?: `0x${string}`;
  indexFromBlock: number;
  blocks: DeploymentBlocks;
};

const CORE_ENV_KEYS = [
  "PONDER_KAR_PASSPORT_ADDRESS",
  "PONDER_KAR_PRO_PASS_ADDRESS",
  "PONDER_KAR_PRO_STAKING_ADDRESS",
  "PONDER_MARKETPLACE_ADDRESS",
] as const;

function parseStartBlockEnv(): number | undefined {
  const raw =
    process.env.PONDER_START_BLOCK_84532?.trim() ||
    process.env.PONDER_START_BLOCK?.trim();
  if (!raw || raw === "latest") return undefined;
  const block = Number.parseInt(raw, 10);
  if (!Number.isFinite(block) || block < 0) return undefined;
  return block;
}

function stackFromManifest(manifest: DeploymentManifest, source: SepoliaStackSource): ResolvedSepoliaStack {
  return {
    source,
    chainId: manifest.chainId,
    generation: manifest.generation,
    karPassport: manifest.karPassport,
    karProPass: manifest.karProPass,
    karProStaking: manifest.karProStaking,
    marketplace: manifest.marketplace,
    marketplaceImpl: manifest.marketplaceImpl,
    usdc: manifest.usdc ?? SEPOLIA_ACTIVE.usdc,
    nativeFeed: manifest.nativeFeed ?? SEPOLIA_ACTIVE.nativeFeed,
    ...(manifest.timelock ? { timelock: manifest.timelock } : {}),
    ...(manifest.proxyOnftAdapter ? { proxyOnftAdapter: manifest.proxyOnftAdapter } : {}),
    indexFromBlock: manifest.indexFromBlock,
    blocks: manifest.blocks,
  };
}

function stackFromCommitted(): ResolvedSepoliaStack {
  return {
    source: "committed",
    chainId: SEPOLIA_CHAIN_ID,
    generation: "v2",
    karPassport: SEPOLIA_ACTIVE.karPassport,
    karProPass: SEPOLIA_ACTIVE.karProPass,
    karProStaking: SEPOLIA_ACTIVE.karProStaking,
    marketplace: SEPOLIA_ACTIVE.marketplace,
    marketplaceImpl: SEPOLIA_ACTIVE.marketplaceImpl,
    usdc: SEPOLIA_ACTIVE.usdc,
    nativeFeed: SEPOLIA_ACTIVE.nativeFeed,
    timelock: SEPOLIA_ACTIVE.timelock,
    proxyOnftAdapter: SEPOLIA_ACTIVE.proxyOnftAdapter,
    indexFromBlock: SEPOLIA_ACTIVE.indexFromBlock,
    blocks: { ...SEPOLIA_ACTIVE.blocks },
  };
}

function stackFromEnv(): ResolvedSepoliaStack | null {
  const karPassport = process.env.PONDER_KAR_PASSPORT_ADDRESS;
  const karProPass = process.env.PONDER_KAR_PRO_PASS_ADDRESS;
  const karProStaking = process.env.PONDER_KAR_PRO_STAKING_ADDRESS;
  const marketplace = process.env.PONDER_MARKETPLACE_ADDRESS;
  if (!karPassport || !karProPass || !karProStaking || !marketplace) return null;

  const manifest = loadSepoliaDeployment();
  const base = manifest ? stackFromManifest(manifest, "env") : stackFromCommitted();

  const indexFromBlock = parseStartBlockEnv() ?? base.indexFromBlock;

  return {
    ...base,
    source: "env",
    karPassport: getAddress(karPassport as `0x${string}`),
    karProPass: getAddress(karProPass as `0x${string}`),
    karProStaking: getAddress(karProStaking as `0x${string}`),
    marketplace: getAddress(marketplace as `0x${string}`),
    marketplaceImpl: process.env.PONDER_MARKETPLACE_IMPL_ADDRESS
      ? getAddress(process.env.PONDER_MARKETPLACE_IMPL_ADDRESS as `0x${string}`)
      : base.marketplaceImpl,
    usdc: process.env.PONDER_USDC_ADDRESS
      ? getAddress(process.env.PONDER_USDC_ADDRESS as `0x${string}`)
      : base.usdc,
    nativeFeed: process.env.PONDER_NATIVE_FEED_ADDRESS
      ? getAddress(process.env.PONDER_NATIVE_FEED_ADDRESS as `0x${string}`)
      : base.nativeFeed,
    indexFromBlock,
  };
}

export function ponderSepoliaAddresses(): PonderAddressBundle {
  const stack = resolveSepoliaStack();
  return {
    karPassport: stack.karPassport,
    karProPass: stack.karProPass,
    karProStaking: stack.karProStaking,
    marketplace: stack.marketplace,
    marketplaceImpl: stack.marketplaceImpl,
  };
}

export function sepoliaBlocksForPonder(): DeploymentBlocks {
  return resolveSepoliaStack().blocks;
}

export function sepoliaIndexFromBlock(): number {
  return resolveSepoliaIndexFromBlock();
}

/** Single resolver: PONDER_* env → deployments/84532.json → lib/web3/sepolia-addresses.ts */
export function resolveSepoliaStack(): ResolvedSepoliaStack {
  const fromEnv = stackFromEnv();
  if (fromEnv) return fromEnv;

  const manifest = loadSepoliaDeployment();
  if (manifest) return stackFromManifest(manifest, "manifest");

  return stackFromCommitted();
}

export function resolveSepoliaIndexFromBlock(): number {
  return parseStartBlockEnv() ?? resolveSepoliaStack().indexFromBlock;
}

export function resolveSepoliaBlocksForPonder(): DeploymentBlocks {
  return resolveSepoliaStack().blocks;
}

type AddressField = keyof Pick<
  ResolvedSepoliaStack,
  "karPassport" | "karProPass" | "karProStaking" | "marketplace" | "marketplaceImpl"
>;

const COMPARE_FIELDS: AddressField[] = [
  "karPassport",
  "karProPass",
  "karProStaking",
  "marketplace",
  "marketplaceImpl",
];

/** Warn when local manifest diverges from committed fallbacks (common VPS drift). */
export function manifestCommittedDrift(): string[] {
  const manifest = loadSepoliaDeployment();
  if (!manifest) return [];

  const committed = stackFromCommitted();
  const warnings: string[] = [];

  for (const field of COMPARE_FIELDS) {
    const a = manifest[field].toLowerCase();
    const b = committed[field].toLowerCase();
    if (a !== b) {
      warnings.push(
        `${field}: manifest ${manifest[field]} ≠ committed ${committed[field]} — git pull or remove stale ${SEPOLIA_DEPLOYMENT_PATH}`,
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

export function formatSepoliaStackReport(stack: ResolvedSepoliaStack): string {
  const lines: string[] = [
    "Kargain Base Sepolia stack (84532)",
    "================================",
    `Address source: ${stack.source}`,
    `Generation:     ${stack.generation}`,
    `indexFromBlock: ${stack.indexFromBlock}`,
    "",
    "Contracts (Ponder + app fallbacks use these when env unset):",
    `  karPassport:      ${stack.karPassport}`,
    `  karProPass:       ${stack.karProPass}`,
    `  karProStaking:    ${stack.karProStaking}`,
    `  marketplace:      ${stack.marketplace}`,
    `  marketplaceImpl:  ${stack.marketplaceImpl}`,
    ...(stack.timelock ? [`  timelock:           ${stack.timelock}`] : []),
    ...(stack.proxyOnftAdapter ? [`  proxyOnftAdapter:   ${stack.proxyOnftAdapter}`] : []),
    "",
    "Network (set once on VPS / Vercel — see .env.example):",
    `  NEXT_PUBLIC_CHAIN_ID=84532`,
    `  NEXT_PUBLIC_RPC_BY_CHAIN={"84532":"${SEPOLIA_PUBLIC_RPC}"}`,
    `  PONDER_RPC_URL_84532=${process.env.PONDER_RPC_URL_84532 ?? SEPOLIA_PUBLIC_RPC}`,
    `  PONDER_START_BLOCK_84532=${stack.indexFromBlock}`,
    "",
  ];

  const drift = manifestCommittedDrift();
  if (drift.length > 0) {
    lines.push("Warnings (manifest vs committed in git):");
    for (const w of drift) lines.push(`  ⚠ ${w}`);
    lines.push("");
  }

  if (stack.source === "committed") {
    lines.push(
      "Ponder contract addresses: no PONDER_*_ADDRESS overrides needed after git pull.",
      "Vercel contract addresses: no NEXT_PUBLIC_* overrides needed (SEPOLIA_ACTIVE in repo).",
    );
  } else if (stack.source === "manifest") {
    lines.push(
      `Using ${SEPOLIA_DEPLOYMENT_PATH} on disk.`,
      "After deploy: commit lib/web3/sepolia-addresses.ts in the same PR, then git pull on VPS.",
    );
  } else {
    lines.push(`Using PONDER_* env overrides (${CORE_ENV_KEYS.join(", ")}).`);
  }

  lines.push(
    "",
    "Reindex: docs/indexer/OPERATIONS.md",
    "  ./scripts/ponder-reindex.sh && docker compose up -d --force-recreate ponder",
  );

  return lines.join("\n");
}

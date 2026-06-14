import { createConfig } from "ponder";
import {
  KarPassportAbi,
  KarProPassAbi,
  KarProStakingAbi,
  MarketplaceEscrowAbi,
} from "./lib/contracts/abis.generated";
import { ponderLocalAddresses } from "./scripts/lib/load-deployment.js";

/**
 * Base Sepolia Model X — final deploy, June 2026.
 * Per-contract creation blocks (for reference / mainnet backfill):
 *   KarProPass: 42800433 · KarProStaking: 42800436
 *   KarPassport: 42800441 · MarketplaceEscrow: 42800447
 *
 * Indexing mode via PONDER_START_BLOCK (server .env, not committed):
 *   latest (default) — index from restart only; publicnode RPC is fine.
 *   42800430         — full history from deploy; run scripts/ponder-reindex.sql first.
 *                      Use Alchemy/QuickNode if publicnode rate-limits eth_getLogs.
 *
 * Localhost (31337): set PONDER_ENABLE_LOCAL=1, PONDER_RPC_URL_31337, PONDER_START_BLOCK=0.
 * Addresses from deployments/31337.json or PONDER_*_ADDRESS env vars.
 *
 * Obsolete: 42781255 belonged to the first testnet generation (0xe356… addresses).
 */
function resolveStartBlock(): number | "latest" {
  const raw = process.env.PONDER_START_BLOCK?.trim();
  if (!raw || raw === "latest") return "latest";
  const block = Number.parseInt(raw, 10);
  if (!Number.isFinite(block) || block < 0) {
    throw new Error(`Invalid PONDER_START_BLOCK: ${raw}`);
  }
  return block;
}

const START_BLOCK = resolveStartBlock();
const LOCAL_START_BLOCK = 0;
const ENABLE_LOCAL = process.env.PONDER_ENABLE_LOCAL === "1";

const BASE_SEPOLIA = {
  karPassport: "0xCfA1eAB89D6D1DE1244CF346D5a4F1E7343E9083" as const,
  karProPass: "0x8e4dcb5C0b415d6c2481D72dFac6da32d9cf22C1" as const,
  karProStaking: "0x2794015C00Da0FAf5D2451Ffba9FdD30F86dBC31" as const,
  marketplace: "0xcD40C83CD57422C616e7e63F562B2e78C269Fb7F" as const,
};

const localAddresses = ENABLE_LOCAL ? ponderLocalAddresses() : null;

const chains: Record<string, { id: number; rpc: string; maxRequestsPerSecond?: number }> = {
  baseSepolia: {
    id: 84532,
    rpc: process.env.PONDER_RPC_URL_84532 ?? "https://base-sepolia.publicnode.com",
    maxRequestsPerSecond: 10,
  },
};

if (ENABLE_LOCAL && localAddresses) {
  chains.localhost = {
    id: 31337,
    rpc: process.env.PONDER_RPC_URL_31337 ?? "http://127.0.0.1:8545",
    maxRequestsPerSecond: 20,
  };
}

function contractChainConfig(sepoliaAddress: `0x${string}`, localAddress?: `0x${string}`) {
  if (ENABLE_LOCAL && localAddress) {
    return {
      chain: {
        baseSepolia: { address: sepoliaAddress, startBlock: START_BLOCK },
        localhost: { address: localAddress, startBlock: LOCAL_START_BLOCK },
      },
    };
  }
  return {
    chain: "baseSepolia" as const,
    address: sepoliaAddress,
    startBlock: START_BLOCK,
  };
}

export default createConfig({
  database: {
    kind: "postgres",
    connectionString:
      process.env.DATABASE_URL ??
      process.env.PONDER_DATABASE_URL ??
      process.env.DATABASE_PRIVATE_URL,
  },
  chains,
  contracts: {
    KarPassport: {
      abi: KarPassportAbi,
      ...contractChainConfig(BASE_SEPOLIA.karPassport, localAddresses?.karPassport),
    },
    KarProPass: {
      abi: KarProPassAbi,
      ...contractChainConfig(BASE_SEPOLIA.karProPass, localAddresses?.karProPass),
    },
    KarProStaking: {
      abi: KarProStakingAbi,
      ...contractChainConfig(BASE_SEPOLIA.karProStaking, localAddresses?.karProStaking),
    },
    MarketplaceEscrow: {
      abi: MarketplaceEscrowAbi,
      ...contractChainConfig(BASE_SEPOLIA.marketplace, localAddresses?.marketplace),
    },
  },
});

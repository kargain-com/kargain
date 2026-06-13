import { createConfig } from "ponder";
import { http } from "viem";
import {
  KarPassportAbi,
  KarProPassAbi,
  KarProStakingAbi,
  MarketplaceEscrowAbi,
} from "./lib/contracts/abis.generated";

/**
 * Base Sepolia Model X — final deploy, June 2026.
 * Per-contract creation blocks (for reference / mainnet backfill):
 *   KarProPass: 42800433 · KarProStaking: 42800436
 *   KarPassport: 42800441 · MarketplaceEscrow: 42800447
 *
 * Toggle indexing mode (one line):
 *   "latest"  — index from restart only (production default; publicnode RPC is fine).
 *   42800430  — full history from deploy; run scripts/ponder-reindex.sql first,
 *               then switch to Alchemy/QuickNode for eth_getLogs backfill.
 *
 * Obsolete: 42781255 belonged to the first testnet generation (0xe356… addresses).
 */
const START_BLOCK = "latest" as const;
// const START_BLOCK = 42800430;

export default createConfig({
  database: {
    kind: "postgres",
    connectionString:
      process.env.DATABASE_URL ??
      process.env.PONDER_DATABASE_URL ??
      process.env.DATABASE_PRIVATE_URL,
  },
  chains: {
    baseSepolia: {
      id: 84532,
      rpc:
        process.env.PONDER_RPC_URL_84532 ??
        "https://base-sepolia.publicnode.com",
      maxRequestsPerSecond: 10,
    },
  },
  contracts: {
    KarPassport: {
      chain: "baseSepolia",
      abi: KarPassportAbi,
      address: "0xCfA1eAB89D6D1DE1244CF346D5a4F1E7343E9083",
      startBlock: START_BLOCK,
    },
    KarProPass: {
      chain: "baseSepolia",
      abi: KarProPassAbi,
      address: "0x8e4dcb5C0b415d6c2481D72dFac6da32d9cf22C1",
      startBlock: START_BLOCK,
    },
    KarProStaking: {
      chain: "baseSepolia",
      abi: KarProStakingAbi,
      address: "0x2794015C00Da0FAf5D2451Ffba9FdD30F86dBC31",
      startBlock: START_BLOCK,
    },
    MarketplaceEscrow: {
      chain: "baseSepolia",
      abi: MarketplaceEscrowAbi,
      address: "0xcD40C83CD57422C616e7e63F562B2e78C269Fb7F",
      startBlock: START_BLOCK,
    },
  },
});

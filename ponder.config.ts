import { createConfig } from "ponder";
import {
  KarPassportAbi,
  KarProPassAbi,
  KarProStakingAbi,
  MarketplaceEscrowAbi,
} from "./lib/contracts/abis.generated";
import { buildPonderRuntime } from "./scripts/lib/ponder-env.js";

/**
 * Indexing is configured via server .env (never committed):
 *
 *   PONDER_START_BLOCK_84532=<N>      — backfill from block N; keep same N after sync (Ponder 0.16)
 *   PONDER_START_BLOCK_84532=latest   — only for fresh installs; changing N→latest changes build_id
 *   PONDER_START_BLOCK_31337=0        — local Hardhat replay
 *   PONDER_RPC_URL_84532              — VPS: https://sepolia.base.org (see docs/indexer/OPERATIONS.md)
 *
 * Addresses: PONDER_*_ADDRESS env → deployments/84532.json → lib/web3/sepolia-addresses.ts (SEPOLIA_ACTIVE)
 *
 * After redeploy: update SEPOLIA_ACTIVE, git pull on VPS, run ponder-reindex.sql — see docs/indexer/OPERATIONS.md
 */
const { chains, addresses, localAddresses, contractEntry, database } = buildPonderRuntime();

export default createConfig({
  database,
  chains,
  contracts: {
    KarPassport: {
      abi: KarPassportAbi,
      ...contractEntry(addresses.karPassport, "karPassport", localAddresses?.karPassport),
    },
    KarProPass: {
      abi: KarProPassAbi,
      ...contractEntry(addresses.karProPass, "karProPass", localAddresses?.karProPass),
    },
    KarProStaking: {
      abi: KarProStakingAbi,
      ...contractEntry(addresses.karProStaking, "karProStaking", localAddresses?.karProStaking),
    },
    MarketplaceEscrow: {
      abi: MarketplaceEscrowAbi,
      ...contractEntry(addresses.marketplace, "marketplace", localAddresses?.marketplace),
    },
  },
});

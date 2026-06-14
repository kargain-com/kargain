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
 *   PONDER_START_BLOCK_84532=latest   — production default after initial sync
 *   PONDER_START_BLOCK_84532=<N>      — one-time backfill (use deployments/84532.json indexFromBlock)
 *   PONDER_START_BLOCK_31337=0        — local Hardhat replay
 *
 * Addresses: PONDER_*_ADDRESS env → deployments/84532.json → committed fallbacks in load-deployment.ts
 *
 * After redeploy: run scripts/ponder-reindex.sql, then eval "$(node --import tsx scripts/lib/print-ponder-env.ts)"
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

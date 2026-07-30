import { createConfig } from "ponder";
import {
  AscendingConsignmentAbi,
  FixedPriceConsignmentAbi,
  KarPassportAbi,
  KarProPassAbi,
  KarProStakingAbi,
} from "./lib/contracts/abis.generated";
import { buildPonderRuntime } from "./scripts/lib/ponder-env.js";

/**
 * Indexing is configured via server .env (never committed):
 *
 *   PONDER_START_BLOCK_84532=<N>       — Base Sepolia backfill (Nuclear hub indexFromBlock 44434865)
 *   PONDER_START_BLOCK_11155111=<N>    — Ethereum Sepolia backfill (Nuclear indexFromBlock 11319840)
 *   PONDER_START_BLOCK_31337=0         — local Hardhat replay
 *   PONDER_RPC_URL_84532               — default: base-sepolia-rpc.publicnode.com
 *   PONDER_RPC_URL_11155111            — default: ethereum-sepolia-rpc.publicnode.com
 *
 * Addresses (SPEC §I.12.12): per chainId via resolveCommercialStack —
 *   optional PONDER_* env (84532 debug) → deployments/<chainId>.json → COMMERCIAL_ACTIVE
 *   VPS needs no deployments/*.json when COMMERCIAL_ACTIVE is current in git.
 *
 * FixedPrice / Ascending: registered when addresses resolve (local always after
 * deploy:local; commercial chains at Nuclear #2). See docs/indexer/MIGRATION-V2.md.
 *
 * After Nuclear redeploy: one full ponder-reindex.sql covers both chains —
 * see docs/indexer/OPERATIONS.md
 */
const {
  chains,
  addresses,
  ethereumSepoliaAddresses,
  localAddresses,
  contractEntry,
  database,
} = buildPonderRuntime();

type DualContract =
  | "karPassport"
  | "karProPass"
  | "karProStaking"
  | "fixedPriceConsignment"
  | "ascendingConsignment";

function dualEntry(
  hubAddress: `0x${string}`,
  contract: DualContract,
  localAddress?: `0x${string}`,
) {
  const ethAddress = ethereumSepoliaAddresses?.[contract];
  return contractEntry(hubAddress, contract, {
    ...(ethAddress ? { ethereumSepoliaAddress: ethAddress } : {}),
    ...(localAddress ? { localAddress } : {}),
  });
}

const fixedPriceAddress =
  addresses.fixedPriceConsignment ?? localAddresses?.fixedPriceConsignment;
const ascendingAddress =
  addresses.ascendingConsignment ?? localAddresses?.ascendingConsignment;

export default createConfig({
  // Cross-chain consistency for owner/status/uri via global timestamp order.
  // Omnichain waits on both networks (consistency > liveness).
  // custodyChain is additionally protected by the monotonic custodyUpdatedAt gate.
  ordering: "omnichain",
  database,
  chains,
  contracts: {
    KarPassport: {
      abi: KarPassportAbi,
      ...dualEntry(addresses.karPassport, "karPassport", localAddresses?.karPassport),
    },
    KarProPass: {
      abi: KarProPassAbi,
      ...dualEntry(addresses.karProPass, "karProPass", localAddresses?.karProPass),
    },
    KarProStaking: {
      abi: KarProStakingAbi,
      ...dualEntry(
        addresses.karProStaking,
        "karProStaking",
        localAddresses?.karProStaking,
      ),
    },
    ...(fixedPriceAddress
      ? {
          FixedPriceConsignment: {
            abi: FixedPriceConsignmentAbi,
            ...dualEntry(
              fixedPriceAddress,
              "fixedPriceConsignment",
              localAddresses?.fixedPriceConsignment,
            ),
          },
        }
      : {}),
    ...(ascendingAddress
      ? {
          AscendingConsignment: {
            abi: AscendingConsignmentAbi,
            ...dualEntry(
              ascendingAddress,
              "ascendingConsignment",
              localAddresses?.ascendingConsignment,
            ),
          },
        }
      : {}),
  },
});

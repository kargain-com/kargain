import { createConfig } from "ponder";
import {
  AscendingConsignmentAbi,
  FixedPriceConsignmentAbi,
  KarPassportAbi,
  KarPassportBridgeGatewayAbi,
  KarProPassAbi,
  KarProStakingAbi,
} from "./lib/contracts/abis.generated";
import { buildPonderRuntime } from "./scripts/lib/ponder-env.js";

/**
 * Indexing is configured via server .env (never committed):
 *
 *   PONDER_START_BLOCK_84532=<N>       — Base Sepolia backfill
 *   PONDER_START_BLOCK_11155111=<N>    — Ethereum Sepolia backfill
 *   PONDER_START_BLOCK_31337=0         — local Hardhat replay
 *   PONDER_RPC_URLS_84532              — comma-separated https list (required; no default)
 *   PONDER_RPC_URLS_11155111           — comma-separated https list (required; no default)
 *   PONDER_GETLOGS_BLOCK_RANGE_84532   — eth_getLogs window (required; no default)
 *   PONDER_GETLOGS_BLOCK_RANGE_11155111
 *   PONDER_RPC_URL_31337               — local Hardhat only
 *
 * Every provider in a commercial list must pass `pnpm ponder:rpc-probe` at the
 * configured window. RPC lists and windows are outside Ponder build_id — profile
 * switches are `.env` + container recreate, no reindex.
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
  optionalAddresses,
  contractEntry,
  database,
} = buildPonderRuntime();

type DualContract =
  | "karPassport"
  | "karProPass"
  | "karProStaking"
  | "bridgeGateway"
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

const fixedPriceAddress = optionalAddresses.FixedPriceConsignment;
const ascendingAddress = optionalAddresses.AscendingConsignment;
const gatewayAddress = optionalAddresses.KarPassportBridgeGateway;

export default createConfig({
  // Cross-chain consistency for owner/status/uri via global timestamp order.
  // Omnichain waits on both networks (consistency > liveness).
  // Stream B custody fold replaces stored passport.custodyChain (S7c-3).
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
    ...(gatewayAddress
      ? {
          KarPassportBridgeGateway: {
            abi: KarPassportBridgeGatewayAbi,
            ...dualEntry(
              gatewayAddress,
              "bridgeGateway",
              localAddresses?.bridgeGateway,
            ),
          },
        }
      : {}),
  },
});

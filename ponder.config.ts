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
 * Commercial chains, addresses and start blocks come from COMMERCIAL_ACTIVE
 * only (ADR 0016 §a, SPEC §I.12.12) — a change is a reviewed registry change,
 * never a server edit. Transport and database come from the server .env:
 *
 *   PONDER_RPC_URLS_84532              — comma-separated https list (required; no default)
 *   PONDER_RPC_URLS_11155111           — comma-separated https list (required; no default)
 *   PONDER_GETLOGS_BLOCK_RANGE_84532   — eth_getLogs window (required; no default)
 *   PONDER_GETLOGS_BLOCK_RANGE_11155111
 *
 * Every provider in a commercial list must pass `pnpm ponder:rpc-probe` at the
 * configured window. RPC lists and windows are outside Ponder build_id — profile
 * switches are `.env` + container recreate, no reindex.
 *
 * Local mode (`PONDER_ENABLE_LOCAL=1`) adds the Hardhat chain from
 * PONDER_*_ADDRESS / deployments/31337.json, PONDER_START_BLOCK_31337 and
 * PONDER_RPC_URL_31337; it changes nothing on commercial chains. The deploy
 * preflight refuses it. Every env read in this closure is classified by
 * scripts/lib/ponder-indexing-env-census.ts.
 *
 * FixedPrice / Ascending: registered when addresses resolve (local always after
 * deploy:local; commercial chains at Nuclear #2). See docs/indexer/MIGRATION-V2.md.
 *
 * Each indexing identity writes its own schema; the deploy switches to it
 * (ADR 0016). See docs/indexer/OPERATIONS.md.
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

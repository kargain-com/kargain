import { createConfig } from "ponder";
import {
  AuctionEscrowAbi,
  KarPassportAbi,
  KarProPassAbi,
  KarProStakingAbi,
  MarketplaceEscrowAbi,
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
 * Addresses: per-chain from deployments/<chainId>.json only (SPEC §I.12.12).
 *   Hub 84532: PONDER_* env → deployments/84532.json → SEPOLIA_ACTIVE
 *   Eth 11155111: deployments/11155111.json (manifest-only)
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

function dualEntry(
  hubAddress: `0x${string}`,
  contract: "karPassport" | "karProPass" | "karProStaking" | "marketplace" | "auctionEscrow",
  localAddress?: `0x${string}`,
) {
  const ethAddress =
    ethereumSepoliaAddresses?.[
      contract === "marketplace"
        ? "marketplace"
        : contract === "auctionEscrow"
          ? "auctionEscrow"
          : contract
    ];
  return contractEntry(hubAddress, contract, {
    ...(ethAddress ? { ethereumSepoliaAddress: ethAddress } : {}),
    ...(localAddress ? { localAddress } : {}),
  });
}

const auctionOnHub = addresses.auctionEscrow;

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
    MarketplaceEscrow: {
      abi: MarketplaceEscrowAbi,
      ...dualEntry(addresses.marketplace, "marketplace", localAddresses?.marketplace),
    },
    ...(auctionOnHub
      ? {
          AuctionEscrow: {
            abi: AuctionEscrowAbi,
            ...dualEntry(
              auctionOnHub,
              "auctionEscrow",
              localAddresses?.auctionEscrow,
            ),
          },
        }
      : {}),
  },
});

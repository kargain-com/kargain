/**
 * Base Sepolia (84532) surface + Ethereum Sepolia (11155111) Nuclear commercial constants.
 * Committed stacks: lib/web3/commercial-active.ts (SPEC I.9.x). Eth is in the wagmi write-union.
 */

import {
  COMMERCIAL_ACTIVE,
  requireCommercialActive,
} from "./commercial-active";

export const SEPOLIA_CHAIN_ID = 84532;

/** Base Sepolia public RPC — Hardhat deploy + Ponder/wagmi reads. Prefer publicnode over sepolia.base.org (flaky on large deploys). */
export const SEPOLIA_PUBLIC_RPC = "https://base-sepolia-rpc.publicnode.com";

/**
 * Active Nuclear stack on Base Sepolia — alias of COMMERCIAL_ACTIVE[84532].
 * KarPassport `1.3.0-rc.1` + KarPassportBridgeGateway `1.1.0-rc.1`.
 */
export const SEPOLIA_ACTIVE = COMMERCIAL_ACTIVE[SEPOLIA_CHAIN_ID]!;

/**
 * Abandoned / historical Kargain contracts on **Base Sepolia only**.
 *
 * WARNING — strictly `chainId === 84532` scoped. Apply this list ONLY when filtering
 * Base Sepolia protocol addresses. Do NOT use chain-blind (address-string-only) matching:
 * the same hex strings can be live contracts on other chains (CREATE nonce collision with
 * one deployer). On **11155111**, `0x637846…4507` and `0x4FC74e…198B` are the live Nuclear
 * KarPassport / MarketplaceEscrow (SPEC I.9.2); treating them as denylisted there would break
 * messaging/profile. Normative rule: SPEC §I.12.12.
 *
 * Nuclear cutover July 21, 2026: prior hub stack + thin ONFT added.
 */
export const SEPOLIA_HISTORICAL_DENYLIST: readonly `0x${string}`[] = [
  "0x6378469256907D7DC14BBfce0261ceDE22314507",
  "0x4FC74e0B7eE0A741707A553D43Efff68126D198B",
  "0x2794015C00Da0FAf5D2451Ffba9FdD30F86dBC31",
  "0x59779D666747AEeDB0d9cc843cB8a68B8ab2470c",
  // Pre-Nuclear hub (June–July 2026 RC stack)
  "0x2C46B2310E2cb09b0FEeDd174D9CD3870137F594",
  "0x9411Af4C4Ec26D939fb1AD04362456Cb41616c19",
  "0xB13D264368C8cbcc8EC973D1E5DDBa435eA458Ce",
  "0xC219bf834B8965339b95C0B6Afe3c4d0F1266Fb0",
  "0xb5d79551BB11F726D2A1A110BAc645C4345dA568",
  "0x8e4dcb5C0b415d6c2481D72dFac6da32d9cf22C1",
  // Thin spoke ONFT (retired)
  "0x5b7fD0ffF9B82255AD4d043a491e81948b76e703",
];

/**
 * Ethereum Sepolia (11155111) — bridge spoke surface (Nuclear full stack).
 * Nuclear full stack: `karPassportOnft` is the Eth KarPassport NFT (ownerOf delivery polls).
 */
export const ETHEREUM_SEPOLIA_CHAIN_ID = 11155111;

/** Official Ethereum Sepolia public RPC — app reads/writes + bridge ownerOf delivery polls. */
export const ETHEREUM_SEPOLIA_PUBLIC_RPC =
  "https://ethereum-sepolia-rpc.publicnode.com";

const ethActive = requireCommercialActive(ETHEREUM_SEPOLIA_CHAIN_ID);

export const ETHEREUM_SEPOLIA_SPOKE = {
  chainId: ETHEREUM_SEPOLIA_CHAIN_ID,
  /** Nuclear Eth KarPassport — NFT ownership for bridge delivery polls. */
  karPassportOnft: ethActive.karPassport,
  /** Eth KarPassportBridgeGateway (OApp peer). */
  bridgeGateway: ethActive.bridgeGateway,
  layerZeroEndpoint: ethActive.layerZeroEndpoint,
  hubEid: 40245,
  spokeEid: 40161,
  blocks: {
    karPassportOnft: ethActive.blocks.karPassport!,
    bridgeGateway: ethActive.blocks.bridgeGateway!,
  },
} as const;

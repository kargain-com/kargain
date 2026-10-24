/**
 * Base Sepolia (84532) surface + Ethereum Sepolia (11155111) Nuclear commercial constants.
 * Committed stacks: lib/web3/commercial-active.ts (SPEC I.9.x). Eth is in the wagmi write-union.
 */

import {
  BASE_SEPOLIA_STACK,
  ETHEREUM_SEPOLIA_STACK,
  evmChainOf,
  type EvmCommercialActiveStack,
} from "./commercial-active";

/** Base Sepolia EIP-155 id — read from the registry row. */
export const SEPOLIA_CHAIN_ID = evmChainOf(BASE_SEPOLIA_STACK);

/** Base Sepolia public RPC — Hardhat deploy + Ponder/wagmi reads. Prefer publicnode over sepolia.base.org (flaky on large deploys). */
export const SEPOLIA_PUBLIC_RPC = "https://base-sepolia-rpc.publicnode.com";

/**
 * Active Nuclear #7 stack on Base Sepolia — alias of COMMERCIAL_ACTIVE[84532].
 * KarPassport `1.11.0-rc.1` · FixedPrice `2.4.0-rc.1` · Ascending `2.5.0-rc.1`.
 */
export const SEPOLIA_ACTIVE: EvmCommercialActiveStack = BASE_SEPOLIA_STACK;

/** Ethereum Sepolia EIP-155 id — read from the registry row. */
export const ETHEREUM_SEPOLIA_CHAIN_ID = evmChainOf(ETHEREUM_SEPOLIA_STACK);

/** Official Ethereum Sepolia public RPC — app reads/writes + bridge ownerOf delivery polls. */
export const ETHEREUM_SEPOLIA_PUBLIC_RPC =
  "https://ethereum-sepolia-rpc.publicnode.com";

const ethActive: EvmCommercialActiveStack = ETHEREUM_SEPOLIA_STACK;

/**
 * Ethereum Sepolia (11155111) — bridge spoke surface (Nuclear full stack).
 * Nuclear full stack: `karPassportOnft` is the Eth KarPassport NFT (ownerOf delivery polls).
 */
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

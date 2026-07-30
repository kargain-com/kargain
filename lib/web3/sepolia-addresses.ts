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
 * Active Nuclear #2 stack on Base Sepolia — alias of COMMERCIAL_ACTIVE[84532].
 * KarPassport `1.8.0-rc.1` · FixedPrice `2.3.0-rc.1` · Ascending `2.2.0-rc.1`.
 */
export const SEPOLIA_ACTIVE = COMMERCIAL_ACTIVE[SEPOLIA_CHAIN_ID]!;

/**
 * Abandoned / historical Kargain contracts on **Base Sepolia only**.
 *
 * WARNING — strictly `chainId === 84532` scoped. Apply this list ONLY when filtering
 * Base Sepolia protocol addresses. Do NOT use chain-blind (address-string-only) matching:
 * the same hex strings can be live contracts on other chains (CREATE nonce collision with
 * one deployer). On **11155111**, `0xC219…6Fb0` is the live Nuclear #2 KarPassport (SPEC I.9.2)
 * while the same hex remains denylisted here as a historical Base adapter. Normative: SPEC §I.12.12.
 *
 * Nuclear #2 cutover July 30, 2026: July 21 Nuclear hub + prior RC/escrow stacks retired.
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
  // Commerce cutover Phase 1 — retired Nuclear legacy escrows (84532)
  "0x60336c550946AF79c8FCfaDfA65d76224B356323",
  "0x0F98B21857386dF0c3B0323c94e63e140533495F",
  "0x37Fa0460Cfc46EC17E1d11D86AA4F9C9e0D79a04",
  "0x5aB1947806d9D28bb5CAB770A586a968EAeaDfF2",
  // July 21 Nuclear hub (superseded by Nuclear #2 July 30)
  "0x899FaE4Bd3612A6268E45E199B0CeFb5310f416a",
  "0xD9B6C20ffE5A9bcEb3771d8a1E39fE35aEfc5b25",
  "0xdEe5eD7e4036C85EEa9d102449E60BBA98Fe257f",
  "0x2a4339656393da943730b7Ac728480f40909f14C",
];

/**
 * Abandoned / historical Kargain contracts on **Ethereum Sepolia only**.
 *
 * WARNING — strictly `chainId === 11155111` scoped; do not use chain-blind matching
 * (see `SEPOLIA_HISTORICAL_DENYLIST`). Normative rule: SPEC §I.12.12.
 *
 * Nuclear #2 cutover July 30, 2026: July 21 Nuclear Eth stack + legacy escrows retired.
 */
export const ETHEREUM_SEPOLIA_HISTORICAL_DENYLIST: readonly `0x${string}`[] = [
  "0x4FC74e0B7eE0A741707A553D43Efff68126D198B",
  "0x7d37e7cbcc42308264B608429a82D03B7C3112F4",
  "0x796Fb1476440C3D8A34a8EC2Fa56664864531499",
  "0xCf78b714DB70960bf1BB418C3370e4502AcFFC64",
  // July 21 Nuclear Eth (superseded by Nuclear #2 July 30)
  "0x6378469256907D7DC14BBfce0261ceDE22314507",
  "0x8888594b12DF2e1EF406e91CFF72d52801BCaC24",
  "0xcD40C83CD57422C616e7e63F562B2e78C269Fb7F",
  "0xEBcd44736C7F1E8Bf3E5f1c98D176732eB134eAB",
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

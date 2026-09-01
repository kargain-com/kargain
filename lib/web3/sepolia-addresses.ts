/**
 * Base Sepolia (84532) surface + Ethereum Sepolia (11155111) Nuclear commercial constants.
 * Committed stacks: lib/web3/commercial-active.ts (SPEC I.9.x). Eth is in the wagmi write-union.
 */

import {
  COMMERCIAL_ACTIVE,
  requireEvmCommercialActive,
} from "./commercial-active";

export const SEPOLIA_CHAIN_ID = 84532;

/** Base Sepolia public RPC — Hardhat deploy + Ponder/wagmi reads. Prefer publicnode over sepolia.base.org (flaky on large deploys). */
export const SEPOLIA_PUBLIC_RPC = "https://base-sepolia-rpc.publicnode.com";

/**
 * Active Nuclear #4 stack on Base Sepolia — alias of COMMERCIAL_ACTIVE[84532].
 * KarPassport `1.10.0-rc.1` · FixedPrice `2.4.0-rc.1` · Ascending `2.4.0-rc.1`.
 */
export const SEPOLIA_ACTIVE = COMMERCIAL_ACTIVE[SEPOLIA_CHAIN_ID]!;

/**
 * Abandoned / historical Kargain contracts on **Base Sepolia only**.
 *
 * WARNING — strictly `chainId === 84532` scoped. Apply this list ONLY when filtering
 * Base Sepolia protocol addresses. Do NOT use chain-blind (address-string-only) matching:
 * the same hex strings can be live contracts on other chains (CREATE nonce collision with
 * one deployer). Example: `0xC219…6Fb0` is denylisted here as a historical Base adapter and
 * also denylisted on Eth as retired Nuclear #2 KarPassport — never match by hex alone.
 * Normative: SPEC §I.12.12.
 *
 * Nuclear #4 cutover August 2, 2026: Nuclear #3 hub + prior stacks retired.
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
  // Nuclear #2 hub (superseded by Nuclear #3 August 1, 2026)
  "0x380021e9a560b8CF1482Cd501F4B2629739b2452",
  "0xD9Ea579DD90b4c5386A55688036d73B9d6bA5d4f",
  "0xC90d6Ecd1BB814eD18E6704f433662541f94fcaD",
  "0xFC33887c97Ff4c65B47279b43c6Ca6817f5528aE",
  "0x77C881b9FB3cD425367c99378588b2790669F51F",
  "0xE98EbDb9354ff9c91872390D7106D621794C9118",
  "0x568f44F238BD1104D8c51Ea93eC92dC91ef5a17D",
  // Nuclear #3 hub (superseded by Nuclear #4 August 2, 2026)
  "0x886328c407998EA493b757bE9d49034624F8f4BE",
  "0xF4bCec8dC6f699c311d75c7aaEb7790c76f0FF43",
  "0xB7563aa97537a804Eb9f9E64f2b92DD7B1c60FD5",
  "0xEf7403424Ce96f0e1845AB70800022c78D97a52C",
  "0xd4728af32553005A2BEae8f29eb73DB425980daa",
  "0x233B0e6780d52275caE1f1d08035F6a3C932B99E",
  "0xf1d84e984CE294C35A654C9d3B7F580104Fa8773",
  "0xC0ADc29De760195d5BBB5d3c11f040B388872039",
  "0x254340154a0C5B1d8679f49400AF292e33E1e855",
];

/**
 * Abandoned / historical Kargain contracts on **Ethereum Sepolia only**.
 *
 * WARNING — strictly `chainId === 11155111` scoped; do not use chain-blind matching
 * (see `SEPOLIA_HISTORICAL_DENYLIST`). Normative rule: SPEC §I.12.12.
 *
 * Nuclear #4 cutover August 2, 2026: Nuclear #3 Eth stack + prior Nuclear/legacy retired.
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
  // Nuclear #2 Eth (superseded by Nuclear #3 August 1, 2026)
  "0x48B0a4205A3CD16BA97FE17222A717c63F6756D8",
  "0xc31197fcBa5D4f373A556b36CD05916fd73a9376",
  "0x3F6594d97FbD9D332866BB7EFB3f1b89554e1249",
  "0xC219bf834B8965339b95C0B6Afe3c4d0F1266Fb0",
  "0xd2c6EAdc9c03741D6A44dB5CF54f520Ee774b655",
  "0xf9dF8c00B89D833A1C7E1210259F9c4F673258E9",
  "0xe8ECf3b42b489F6289434840661770b43B027F13",
  // Nuclear #3 Eth (superseded by Nuclear #4 August 2, 2026)
  "0x20683ca58425DA09B148242432318EeFbfbfFAb1",
  "0xFc12ea568DD7aa636C64f4f778b965D2434D0054",
  "0xea8Ee6b1E9f1a6D6F1229EC498f1A93Fcddd02CB",
  "0xc903feE4395dd5Db35d9BcB558917f3Af8d71869",
  "0x3aC463aE600BB80Fe1b0Da20f2996Fd3F6e02E41",
  "0xe9c06240059800228aB5f8c39f1a323dAFBA84a1",
  "0x1424084C800b4712D835d244904915D1e62B2f21",
  "0x07f9c182F176C2C4A82Fcb80c4f942864420542D",
  "0x3ef0bD0e9446D5C3B7A10A1e0563b1d5a96afc4E",
];

/**
 * Ethereum Sepolia (11155111) — bridge spoke surface (Nuclear full stack).
 * Nuclear full stack: `karPassportOnft` is the Eth KarPassport NFT (ownerOf delivery polls).
 */
export const ETHEREUM_SEPOLIA_CHAIN_ID = 11155111;

/** Official Ethereum Sepolia public RPC — app reads/writes + bridge ownerOf delivery polls. */
export const ETHEREUM_SEPOLIA_PUBLIC_RPC =
  "https://ethereum-sepolia-rpc.publicnode.com";

const ethActive = requireEvmCommercialActive(ETHEREUM_SEPOLIA_CHAIN_ID);

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

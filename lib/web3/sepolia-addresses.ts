/** Base Sepolia (84532) — single source for committed fallbacks. Canonical doc: docs/contracts/SPEC.md Part I.9.1 */

export const SEPOLIA_CHAIN_ID = 84532;

/** Base Sepolia public RPC — Hardhat deploy + Ponder/wagmi reads. Prefer publicnode over sepolia.base.org (flaky on large deploys). */
export const SEPOLIA_PUBLIC_RPC = "https://base-sepolia-rpc.publicnode.com";

/**
 * Active Nuclear stack — July 21, 2026 cutover.
 * KarPassport `1.3.0-rc.1` + KarPassportBridgeGateway `1.1.0-rc.1` (manifest key `proxyOnftAdapter`).
 * Addresses from `deployments/84532.json`.
 */
export const SEPOLIA_ACTIVE = {
  karPassport: "0x899FaE4Bd3612A6268E45E199B0CeFb5310f416a",
  karProPass: "0xD9B6C20ffE5A9bcEb3771d8a1E39fE35aEfc5b25",
  karProStaking: "0xdEe5eD7e4036C85EEa9d102449E60BBA98Fe257f",
  marketplace: "0x60336c550946AF79c8FCfaDfA65d76224B356323",
  marketplaceImpl: "0x0F98B21857386dF0c3B0323c94e63e140533495F",
  usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  nativeFeed: "0x4aDC67696bA383F43DD60A9e78F2C97Fbbfc7cb1",
  /** Chainlink EUR/USD — not registered on USD-only Nuclear marketplace; kept for display/FX helpers. */
  eurFeed: "0xb49f677943BC038e9857d61E7d053CaA2C1734C1",
  timelock: "0x9730A0e7B97d15d9Fb1668690B3b46331e6E1760",
  /** KarPassportBridgeGateway (manifest key remains `proxyOnftAdapter`). */
  proxyOnftAdapter: "0x2a4339656393da943730b7Ac728480f40909f14C",
  auctionEscrow: "0x37Fa0460Cfc46EC17E1d11D86AA4F9C9e0D79a04",
  layerZeroEndpoint: "0x6EDCE65403992e310A62460808c4b910D972f10f",
  platformRecipient: "0xcfe194fea9727bD04dA8F78c2362680986e02dF1",
  deployer: "0xcf1Eb0E7ed453Ed266bF90E7C09e0E4769580b77",
  upgradeAuthority: "0x9730A0e7B97d15d9Fb1668690B3b46331e6E1760",
  indexFromBlock: 44_434_865,
  blocks: {
    timelock: 44_434_875,
    karProPass: 44_434_878,
    karProStaking: 44_434_885,
    karPassport: 44_434_921,
    marketplaceImpl: 44_434_934,
    marketplace: 44_434_937,
    auctionEscrowImpl: 44_434_946,
    auctionEscrow: 44_434_977,
    proxyOnftAdapter: 44_434_981,
  },
} as const satisfies Record<string, `0x${string}` | number | Record<string, number>>;

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
 * Ethereum Sepolia spoke (11155111) — read-only in the app (not in wagmi write union).
 * Thin ONFT address retained until C4 app wiring; live full stack: SPEC I.9.2 + `deployments/11155111.json`.
 */
export const ETHEREUM_SEPOLIA_CHAIN_ID = 11155111;

/** Official Ethereum Sepolia public RPC — spoke ownerOf polls only. */
export const ETHEREUM_SEPOLIA_PUBLIC_RPC =
  "https://ethereum-sepolia-rpc.publicnode.com";

export const ETHEREUM_SEPOLIA_SPOKE = {
  chainId: ETHEREUM_SEPOLIA_CHAIN_ID,
  karPassportOnft: "0x5b7fD0ffF9B82255AD4d043a491e81948b76e703",
  layerZeroEndpoint: "0x6EDCE65403992e310A62460808c4b910D972f10f",
  hubEid: 40245,
  spokeEid: 40161,
  blocks: {
    karPassportOnft: 11_312_959,
  },
} as const;

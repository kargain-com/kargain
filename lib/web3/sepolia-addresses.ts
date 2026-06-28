/** Base Sepolia (84532) — single source for committed fallbacks. Canonical doc: docs/contracts/SPEC.md Part I.9.1 */

export const SEPOLIA_CHAIN_ID = 84532;

/** Active generation v2 stack — June 27, 2026 deploy. Semver `-rc.1` on testnet. */
export const SEPOLIA_ACTIVE = {
  karPassport: "0x2C46B2310E2cb09b0FEeDd174D9CD3870137F594",
  karProPass: "0x8e4dcb5C0b415d6c2481D72dFac6da32d9cf22C1",
  karProStaking: "0xb5d79551BB11F726D2A1A110BAc645C4345dA568",
  marketplace: "0x9411Af4C4Ec26D939fb1AD04362456Cb41616c19",
  marketplaceImpl: "0x58d5e740B29Ab549fBD4d0A147fcDedc32E0b6a3",
  usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  nativeFeed: "0x4aDC67696bA383F43DD60A9e78F2C97Fbbfc7cb1",
  eurFeed: "0xb49f677943BC038e9857d61E7d053CaA2C1734C1",
  timelock: "0x9319e223ff31c954A940b14F04025B56A53ED384",
  proxyOnftAdapter: "0x59779D666747AEeDB0d9cc843cB8a68B8ab2470c",
  layerZeroEndpoint: "0x6EDCE65403992e310A62460808c4b910D972f10f",
  platformRecipient: "0xcfe194fea9727bD04dA8F78c2362680986e02dF1",
  deployer: "0xcf1Eb0E7ed453Ed266bF90E7C09e0E4769580b77",
  upgradeAuthority: "0x9319e223ff31c954A940b14F04025B56A53ED384",
  indexFromBlock: 43_399_242,
  blocks: {
    timelock: 43_399_252,
    karProStaking: 43_399_255,
    karPassport: 43_399_258,
    marketplaceImpl: 43_399_261,
    marketplace: 43_399_264,
    proxyOnftAdapter: 43_399_505,
  },
} as const satisfies Record<string, `0x${string}` | number | Record<string, number>>;

/** v1.x contracts still on-chain — messaging denylist only. Historical: SPEC Part II.4 */
export const SEPOLIA_HISTORICAL_DENYLIST: readonly `0x${string}`[] = [
  "0x6378469256907D7DC14BBfce0261ceDE22314507",
  "0x4FC74e0B7eE0A741707A553D43Efff68126D198B",
  "0x2794015C00Da0FAf5D2451Ffba9FdD30F86dBC31",
];

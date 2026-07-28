/** Must match on-chain `VERSION` constants. Semver + `-rc.N` on testnet; drop pre-release on mainnet (spec §11). */
export const CONTRACT_VERSIONS = {
  KarPassport: "1.5.1-rc.1",
  KarProPass: "1.0.0-rc.1",
  KarProStaking: "1.3.0-rc.1",
  MarketplaceEscrow: "2.1.0-rc.2",
  Timelock48h: "1.0.0-rc.1",
  KarPassportBridgeGateway: "1.1.2-rc.1",
  /** @deprecated C2 — removed thin ONFT; kept for historical smoke key lookups */
  KarPassportONFT721: "1.0.0-rc.1",
  /** @deprecated C2 — removed adapter; kept for historical smoke key lookups */
  ProxyONFT721Adapter: "1.1.0-rc.1",
  AuctionEscrow: "2.0.1-draft",
} as const;

export type ContractVersionName = keyof typeof CONTRACT_VERSIONS;

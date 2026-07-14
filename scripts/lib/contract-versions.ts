/** Must match on-chain `VERSION` constants. Semver + `-rc.N` on testnet; drop pre-release on mainnet (spec §11). */
export const CONTRACT_VERSIONS = {
  KarPassport: "1.2.0-rc.1",
  KarProPass: "1.0.0-rc.1",
  KarProStaking: "1.1.0-rc.1",
  MarketplaceEscrow: "2.0.0-rc.1",
  Timelock48h: "1.0.0-rc.1",
  KarPassportONFT721: "1.0.0-rc.1",
  ProxyONFT721Adapter: "1.0.0-rc.1",
  AuctionEscrow: "1.0.1-draft",
} as const;

export type ContractVersionName = keyof typeof CONTRACT_VERSIONS;

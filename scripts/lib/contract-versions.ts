/** Must match `VERSION` constants in production Solidity contracts. */
export const CONTRACT_VERSIONS = {
  KarPassport: "1.2.0-rc.1",
  KarProPass: "1.0.0-rc.1",
  KarProStaking: "1.1.0-rc.1",
  MarketplaceEscrow: "2.0.0-rc.1",
  Timelock48h: "1.0.0-rc.1",
  KarPassportONFT721: "1.0.0-rc.1",
  ProxyONFT721Adapter: "1.0.0-rc.1",
} as const;

export type ContractVersionName = keyof typeof CONTRACT_VERSIONS;

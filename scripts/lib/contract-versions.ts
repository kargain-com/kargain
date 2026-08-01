/** Must match on-chain `VERSION` constants. Semver + `-rc.N` on testnet; drop pre-release on mainnet (spec §11).
 *  Nuclear #3 ship numbers — bump with the full commercial redeploy that makes them real on chain.
 */
export const CONTRACT_VERSIONS = {
  KarPassport: "1.9.0-rc.1",
  KarProPass: "1.1.0-rc.1",
  KarProStaking: "2.1.0-rc.1",
  Timelock48h: "1.0.0-rc.1",
  KarPassportBridgeGateway: "1.3.0-rc.1",
  /** @deprecated C2 — removed thin ONFT; retained for verify/historical label lookups */
  KarPassportONFT721: "1.0.0-rc.1",
  /** @deprecated C2 — removed adapter; retained for verify/historical label lookups */
  ProxyONFT721Adapter: "1.1.0-rc.1",
  FixedPriceConsignment: "2.4.0-rc.1",
  AscendingConsignment: "2.3.0-rc.1",
} as const;

export type ContractVersionName = keyof typeof CONTRACT_VERSIONS;

/** Must match on-chain `VERSION` constants. Semver + `-rc.N` on testnet; drop pre-release on mainnet (spec §11).
 *  Source VERSIONs are the Nuclear #2 ship numbers and are amended in place until that version exists on a chain.
 */
export const CONTRACT_VERSIONS = {
  KarPassport: "1.8.0-rc.1",
  KarProPass: "1.1.0-rc.1",
  KarProStaking: "2.0.0-rc.1",
  Timelock48h: "1.0.0-rc.1",
  KarPassportBridgeGateway: "1.3.0-rc.1",
  /** @deprecated C2 — removed thin ONFT; kept for historical smoke key lookups */
  KarPassportONFT721: "1.0.0-rc.1",
  /** @deprecated C2 — removed adapter; kept for historical smoke key lookups */
  ProxyONFT721Adapter: "1.1.0-rc.1",
  FixedPriceConsignment: "2.1.0-rc.1",
  AscendingConsignment: "2.1.0-rc.1",
} as const;

export type ContractVersionName = keyof typeof CONTRACT_VERSIONS;

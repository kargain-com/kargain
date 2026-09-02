/**
 * Shared S8-1 consumer wiring predicates (pure string checks).
 */

export function instrumentReadoutsWiringOk(source: string): boolean {
  return (
    /from\s+["']@\/lib\/web3\/network-explorer["']/.test(source) &&
    /explorerAddressUrl\s*\(\s*requireCommercialActive\s*\(/.test(source) &&
    !/explorerAddressUrl\s*\(\s*\d+/.test(source)
  );
}

export function indexerKeyWiringOk(source: string, prefix: string): boolean {
  const re = new RegExp(
    `indexerQueryKey\\s*\\(\\s*["']${prefix}["']\\s*,\\s*targetChain|indexerQueryKey\\s*\\(\\s*["']${prefix}["']\\s*,\\s*chainId`,
  );
  return (
    /from\s+["']@\/lib\/web3\/indexer-query-keys["']/.test(source) &&
    re.test(source) &&
    !new RegExp(`queryKey:\\s*\\[\\s*["']${prefix}["']`).test(source)
  );
}

export function chainlinkFxWiringOk(source: string): boolean {
  return (
    /fxRateChainIdFor\s*\(\s*requireCommercialActive\s*\(\s*FX_RATE_CHAIN_ID\s*\)/.test(
      source,
    ) && !/\bfxRateChainId\s*\(/.test(source)
  );
}

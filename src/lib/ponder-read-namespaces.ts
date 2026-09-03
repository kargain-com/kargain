/**
 * Namespace list for indexer HTTP UNION reads (entity / provenance / custody).
 * Commercial ids from the registry; Hardhat localhost only when Ponder local
 * indexing is enabled. Not the commercial-active registry.
 */

import { registeredCommercialNamespaceIds } from "../../lib/web3/commercial-active.js";
import { LOCALHOST_CHAIN_ID } from "../../lib/web3/deployment-addresses.js";

/**
 * Namespaces allowed on UNION `ANY(...)` filters.
 * Product loaders use this; tests may override per call.
 */
export function indexerReadNamespaceIds(): readonly number[] {
  const ids = [...registeredCommercialNamespaceIds()];
  if (process.env.PONDER_ENABLE_LOCAL === "1" && !ids.includes(LOCALHOST_CHAIN_ID)) {
    ids.push(LOCALHOST_CHAIN_ID);
  }
  return ids;
}

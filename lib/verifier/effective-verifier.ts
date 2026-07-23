/**
 * Chain-authoritative verifier *active* merge for discovery surfaces.
 * Mirrors `resolveEffectiveListing`: successful chain reads win; Ponder is
 * fallback only when the commercial-union batch fails.
 */

export type ChainVerifierRead = "success" | "failure";

/**
 * A successful chain read is authoritative (including inactive).
 * On failure, keep the Ponder projection.
 */
export function resolveEffectiveVerifierActive(
  chainRead: ChainVerifierRead,
  chainActive: boolean | null,
  ponderActive: boolean,
): boolean {
  if (chainRead === "success") return chainActive === true;
  return ponderActive === true;
}

/**
 * Filter directory rows by effective active status.
 * Map keys must be lowercased addresses; missing key on success → inactive.
 */
export function filterVerifierDirectoryEntries<
  T extends { address: string; active: boolean },
>(
  rows: readonly T[],
  chainRead: ChainVerifierRead,
  activeByAddress: ReadonlyMap<string, boolean>,
): T[] {
  return rows.filter((row) => {
    const key = row.address.toLowerCase();
    const chainActive =
      chainRead === "success" ? (activeByAddress.get(key) ?? false) : null;
    return resolveEffectiveVerifierActive(chainRead, chainActive, row.active);
  });
}

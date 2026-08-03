/**
 * Chain-authoritative verifier *active* merge for discovery surfaces.
 * Mirrors `resolveEffectiveListing`: successful chain reads win; Ponder is
 * fallback only when the membership batch fails.
 */

import { verifierMembershipKey } from "@/lib/kar-pro/is-active-verifier-commercial";

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
 * Filter directory rows by effective active status per membership.
 * Map keys = {@link verifierMembershipKey}; missing key on success → inactive.
 */
export function filterVerifierDirectoryEntries<
  T extends { address: string; chainId: number; active: boolean },
>(
  rows: readonly T[],
  chainRead: ChainVerifierRead,
  activeByMembership: ReadonlyMap<string, boolean>,
): T[] {
  return rows.filter((row) => {
    const key = verifierMembershipKey(row.chainId, row.address);
    const chainActive =
      chainRead === "success" ? (activeByMembership.get(key) ?? false) : null;
    return resolveEffectiveVerifierActive(chainRead, chainActive, row.active);
  });
}

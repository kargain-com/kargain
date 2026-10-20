/**
 * Chain-authoritative verifier *active* merge for discovery surfaces.
 * Mirrors `resolveEffectiveListing`: successful chain reads win; Ponder is
 * fallback when the membership batch fails or a membership is unread.
 */

import { verifierMembershipKey } from "@/lib/kar-pro/is-active-verifier-commercial";

export type ChainVerifierRead = "success" | "failure";

/**
 * A successful chain read is authoritative when known (including inactive).
 * Unread (`null`) and batch failure fall back to the Ponder projection.
 */
export function resolveEffectiveVerifierActive(
  chainRead: ChainVerifierRead,
  chainActive: boolean | null,
  ponderActive: boolean,
): boolean {
  if (chainRead === "success" && chainActive !== null) {
    return chainActive === true;
  }
  return ponderActive === true;
}

/**
 * Showroom open/closed from membership + Ponder — one answer for metadata and body.
 * `null` membership (unread / failed / non-EVM) falls back to Ponder; never invent open.
 */
export function showroomOpenFromMembership(
  isActiveVerifier: boolean | null,
  ponderActive: boolean,
): boolean {
  return resolveEffectiveVerifierActive("success", isActiveVerifier, ponderActive);
}

/**
 * Filter directory rows by effective active status per membership.
 * Map keys = {@link verifierMembershipKey}; missing key on success → unread
 * (Ponder fallback), never invent inactive.
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
    let chainActive: boolean | null = null;
    if (chainRead === "success") {
      const known = activeByMembership.get(key);
      if (known !== undefined) chainActive = known;
    }
    return resolveEffectiveVerifierActive(chainRead, chainActive, row.active);
  });
}

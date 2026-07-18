/** Ambient homepage stats counts for the marketplace strip. */
export type MarketplaceStatsLineCounts = {
  listings: number;
  auctions: number;
  verified: number;
  activeVerifiers: number;
};

/**
 * Compact mono ambient line: `N listings · M auctions · V verified · A active verifiers`.
 * Omits zero segments; returns `null` when every count is ≤ 0.
 */
export function formatMarketplaceStatsLine(
  counts: MarketplaceStatsLineCounts,
): string | null {
  const segments: string[] = [];
  if (counts.listings > 0) segments.push(`${counts.listings} listings`);
  if (counts.auctions > 0) segments.push(`${counts.auctions} auctions`);
  if (counts.verified > 0) segments.push(`${counts.verified} verified`);
  if (counts.activeVerifiers > 0) {
    segments.push(`${counts.activeVerifiers} active verifiers`);
  }
  if (segments.length === 0) return null;
  return segments.join(" · ");
}

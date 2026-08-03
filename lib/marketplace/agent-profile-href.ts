import { proShowroomHref } from "@/lib/kar-pro/pro-showroom-href";

/**
 * Pro showroom when slug + membership chain exist; otherwise unified profile route.
 * Bare `/pro/${slug}` is never produced — chain is required for showroom links.
 */
export function agentProfileHref(
  slug: string | undefined | null,
  address: string,
  chainId: number | null | undefined,
): string {
  const trimmed = slug?.trim() ?? "";
  if (trimmed && chainId != null && Number.isFinite(chainId) && chainId > 0) {
    return proShowroomHref(trimmed, chainId);
  }
  return `/profile/${address}`;
}

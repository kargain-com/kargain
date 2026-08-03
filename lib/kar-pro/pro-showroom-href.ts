/**
 * Sole owner of public KarPro showroom URLs.
 * Membership chain is always explicit — never bare `/pro/${slug}`.
 */

export function proShowroomHref(slug: string, chainId: number): string {
  const trimmed = slug.trim();
  return `/pro/${encodeURIComponent(trimmed)}?chain=${chainId}`;
}

export function proConsignmentsHref(slug: string, chainId: number): string {
  const trimmed = slug.trim();
  return `/pro/${encodeURIComponent(trimmed)}/consignments?chain=${chainId}`;
}

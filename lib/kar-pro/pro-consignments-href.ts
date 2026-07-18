/** Public Pro catalog of active fixed-price consignments for a KarPro slug. */
export function proConsignmentsHref(slug: string): string {
  return `/pro/${encodeURIComponent(slug)}/consignments`;
}

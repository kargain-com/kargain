/** Pro showroom when slug exists; otherwise unified profile route. */
export function agentProfileHref(
  slug: string | undefined | null,
  address: string,
): string {
  const trimmed = slug?.trim() ?? "";
  return trimmed ? `/pro/${trimmed}` : `/profile/${address}`;
}

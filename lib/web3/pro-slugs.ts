export const PRO_SLUGS: Record<string, string> = {};

export function proSlugForAddress(address: string): string | null {
  const lower = address.trim().toLowerCase();
  for (const [slug, slugAddress] of Object.entries(PRO_SLUGS)) {
    if (slugAddress.toLowerCase() === lower) return slug;
  }
  return null;
}

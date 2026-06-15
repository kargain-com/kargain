export const PRO_SLUGS: Record<string, string> = {
  "ray-connection": "0xcf1Eb0E7ed453Ed266bF90E7C09e0E4769580b77",
};

export function proSlugForAddress(address: string): string | null {
  const lower = address.trim().toLowerCase();
  for (const [slug, slugAddress] of Object.entries(PRO_SLUGS)) {
    if (slugAddress.toLowerCase() === lower) return slug;
  }
  return null;
}

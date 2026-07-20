"use server";

import { fetchSlugAvailability, type SlugAvailabilityResult } from "@/lib/kar-pro/slug-availability";

export type { SlugAvailabilityResult };

export async function checkSlugAvailability(
  slug: string,
  ownerAddress?: string,
): Promise<SlugAvailabilityResult> {
  return fetchSlugAvailability({ slug, ownerAddress });
}

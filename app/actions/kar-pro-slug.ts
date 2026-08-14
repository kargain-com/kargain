"use server";

import {
  buildSlugAvailableUrl,
  ponderFetch,
} from "@/lib/web3/ponder-fetch";
import {
  slugAvailabilityFromPonderPayload,
  type SlugAvailabilityResult,
} from "@/lib/kar-pro/slug-availability";
import { isValidSlug } from "@/lib/kar-pro/kar-pro-slug-rules";

/**
 * Check slug uniqueness against Ponder. Soft-fails to `{ reason: "error" }`
 * on network/upstream failure (never throws for those).
 *
 * Do not re-export types from this file — Next treats `export type` in
 * `"use server"` modules as runtime server references and crashes the action
 * bundle on evaluation.
 */
export async function checkSlugAvailability(
  slug: string,
  ownerAddress?: string,
): Promise<SlugAvailabilityResult> {
  const trimmed = slug.trim();
  if (!isValidSlug(trimmed)) {
    return { available: false, reason: "invalid_format" };
  }

  try {
    const res = await ponderFetch(
      "kar-pro-slug-availability",
      buildSlugAvailableUrl(trimmed, ownerAddress),
    );
    if (!res.ok) {
      return { available: false, reason: "error" };
    }
    const data = res.body as { available?: boolean };
    return slugAvailabilityFromPonderPayload(data);
  } catch {
    return { available: false, reason: "error" };
  }
}

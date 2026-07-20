"use server";

import { isValidSlug } from "@/lib/kar-pro/kar-pro-slug-rules";
import {
  buildSlugAvailablePath,
  slugAvailabilityFromPonderPayload,
  type SlugAvailabilityResult,
} from "@/lib/kar-pro/slug-availability";

const PONDER_URL =
  process.env.PONDER_SQL_API_URL?.trim().replace(/\/+$/, "") ||
  "http://localhost:42069";

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
    const res = await fetch(
      `${PONDER_URL}${buildSlugAvailablePath(trimmed, ownerAddress)}`,
      { cache: "no-store" },
    );
    if (!res.ok) {
      return { available: false, reason: "error" };
    }
    const data = (await res.json()) as { available?: boolean };
    return slugAvailabilityFromPonderPayload(data);
  } catch {
    return { available: false, reason: "error" };
  }
}

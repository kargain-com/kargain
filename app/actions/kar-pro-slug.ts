"use server";

import { isValidSlug } from "@/lib/kar-pro/kar-pro-slug-rules";

const PONDER_URL =
  process.env.PONDER_SQL_API_URL ?? "http://localhost:42069";

export type SlugAvailabilityResult = {
  available: boolean;
  reason?: "invalid_format" | "invalid_length" | "taken" | "error";
};

export async function checkSlugAvailability(
  slug: string,
  ownerAddress?: string,
): Promise<SlugAvailabilityResult> {
  const trimmed = slug.trim();

  if (!isValidSlug(trimmed)) {
    return { available: false, reason: "invalid_format" };
  }

  try {
    const params = new URLSearchParams();
    if (ownerAddress) {
      params.set("address", ownerAddress);
    }
    const query = params.toString();
    const url = `${PONDER_URL}/verifiers/slug-available/${encodeURIComponent(trimmed)}${query ? `?${query}` : ""}`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
      return { available: false, reason: "error" };
    }
    const data = (await res.json()) as { available?: boolean };
    if (data.available === true) {
      return { available: true };
    }
    return { available: false, reason: "taken" };
  } catch {
    return { available: false, reason: "error" };
  }
}

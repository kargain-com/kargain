"use server";

import {
  SLUG_MAX_LENGTH,
  SLUG_MIN_LENGTH,
  SLUG_PATTERN,
} from "@/lib/kar-pro/kar-pro-metadata";

const PONDER_URL =
  process.env.PONDER_SQL_API_URL ?? "http://localhost:42069";

export async function checkSlugAvailability(
  slug: string,
  ownerAddress?: string,
): Promise<{ available: boolean; reason?: string }> {
  const trimmed = slug.trim();

  if (!SLUG_PATTERN.test(trimmed)) {
    return { available: false, reason: "invalid_format" };
  }

  if (trimmed.length < SLUG_MIN_LENGTH || trimmed.length > SLUG_MAX_LENGTH) {
    return { available: false, reason: "invalid_length" };
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
    return { available: data.available === true };
  } catch {
    return { available: false, reason: "error" };
  }
}

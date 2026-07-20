import { isValidSlug, slugFormatStatus } from "@/lib/kar-pro/kar-pro-slug-rules";

export type SlugAvailabilityResult = {
  available: boolean;
  reason?: "invalid_format" | "invalid_length" | "taken" | "error";
};

export type SlugAvailabilityStatus =
  | "idle"
  | "checking"
  | "available"
  | "taken"
  | "invalid_format"
  | "error";

/** Resolve Ponder base URL (trim; empty env → local default; no trailing slash). */
export function resolvePonderApiBaseUrl(
  envValue: string | undefined = process.env.PONDER_SQL_API_URL,
): string {
  const trimmed = envValue?.trim();
  if (!trimmed) return "http://localhost:42069";
  return trimmed.replace(/\/+$/, "");
}

/**
 * Check slug uniqueness against Ponder. Injectable fetch for unit tests;
 * production callers use the thin server action in `app/actions/kar-pro-slug.ts`.
 */
export async function fetchSlugAvailability(input: {
  slug: string;
  ownerAddress?: string;
  ponderBaseUrl?: string;
  fetchImpl?: typeof fetch;
}): Promise<SlugAvailabilityResult> {
  const trimmed = input.slug.trim();
  if (!isValidSlug(trimmed)) {
    return { available: false, reason: "invalid_format" };
  }

  const base = input.ponderBaseUrl ?? resolvePonderApiBaseUrl();
  const fetchImpl = input.fetchImpl ?? fetch;

  try {
    const params = new URLSearchParams();
    if (input.ownerAddress?.trim()) {
      params.set("address", input.ownerAddress.trim());
    }
    const query = params.toString();
    const url = `${base}/verifiers/slug-available/${encodeURIComponent(trimmed)}${query ? `?${query}` : ""}`;
    const res = await fetchImpl(url, { cache: "no-store" });
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

/** Map a wire/API result onto UI status (never "checking" / "idle"). */
export function mapSlugAvailabilityResult(
  result: SlugAvailabilityResult,
): Exclude<SlugAvailabilityStatus, "checking" | "idle"> {
  if (result.available) return "available";
  if (result.reason === "invalid_format" || result.reason === "invalid_length") {
    return "invalid_format";
  }
  if (result.reason === "error") return "error";
  return "taken";
}

/**
 * Derive the status shown while format is known and the network result may
 * still be pending or keyed to a different slug.
 */
export function deriveSlugAvailabilityStatus(input: {
  slug: string;
  debouncedSlug: string;
  querySlug: string | undefined;
  queryStatus: Exclude<SlugAvailabilityStatus, "checking" | "idle"> | undefined;
  isFetching: boolean;
  isError: boolean;
}): SlugAvailabilityStatus {
  const format = slugFormatStatus(input.slug);
  if (format === "idle") return "idle";
  if (format === "invalid_format") return "invalid_format";

  const trimmed = input.slug.trim();
  if (trimmed !== input.debouncedSlug) return "checking";

  if (input.isError) return "error";

  if (
    input.querySlug === trimmed &&
    input.queryStatus !== undefined &&
    !input.isFetching
  ) {
    return input.queryStatus;
  }

  return "checking";
}

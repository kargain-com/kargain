import { slugFormatStatus } from "@/lib/kar-pro/kar-pro-slug-rules";
import { buildSlugAvailableUrl } from "@/lib/web3/ponder-urls";

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

/** Build the Ponder path (+ query) for a slug availability check. */
export function buildSlugAvailablePath(
  slug: string,
  ownerAddress?: string,
): string {
  const url = new URL(buildSlugAvailableUrl(slug, ownerAddress));
  return `${url.pathname}${url.search}`;
}

/** Map a successful Ponder JSON body onto the wire result (taken vs available). */
export function slugAvailabilityFromPonderPayload(data: {
  available?: boolean;
}): SlugAvailabilityResult {
  if (data.available === true) {
    return { available: true };
  }
  return { available: false, reason: "taken" };
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

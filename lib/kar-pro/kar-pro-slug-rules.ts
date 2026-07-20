export const SLUG_MIN_LENGTH = 3;
export const SLUG_MAX_LENGTH = 32;
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** True when the slug matches length + character rules (ready for uniqueness check). */
export function isValidSlug(slug: string): boolean {
  return (
    slug.length >= SLUG_MIN_LENGTH &&
    slug.length <= SLUG_MAX_LENGTH &&
    SLUG_PATTERN.test(slug)
  );
}

export type SlugFormatStatus = "idle" | "invalid_format" | "ready";

/** Sync format gate before any network availability check. */
export function slugFormatStatus(slug: string): SlugFormatStatus {
  const trimmed = slug.trim();
  if (!trimmed) return "idle";
  if (!isValidSlug(trimmed)) return "invalid_format";
  return "ready";
}

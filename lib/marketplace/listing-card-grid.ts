/** Shared marketplace shell container — matches nav, filter bar, and grid. */
export const MARKETPLACE_SHELL_CONTAINER =
  "mx-auto w-full max-w-7xl px-6 md:px-8 xl:max-w-[80rem]";

/** Shared ListingCard grid — equal row heights via auto-rows-fr. */
export const LISTING_CARD_GRID_WIDE =
  "grid auto-rows-fr grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-3";

export const LISTING_CARD_GRID_NARROW =
  "grid auto-rows-fr grid-cols-1 gap-3 sm:grid-cols-2";

export const LISTING_CARD_GRID_PRO =
  "grid auto-rows-fr grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3";

/**
 * Max cards in the first grid row across WIDE (`xl:3`) and PRO (`lg:3`).
 * Eager / priority budget for LCP — not invented in card components.
 */
export const LISTING_CARD_FIRST_VIEWPORT_COUNT = 3;

/** `sizes` for WIDE / PRO card grids (1 → sm:2 → xl/lg:3). */
export const LISTING_CARD_IMAGE_SIZES =
  "(max-width: 639px) 100vw, (max-width: 1279px) 50vw, 33vw";

/** `sizes` for NARROW profile grids (1 → sm:2). */
export const LISTING_CARD_IMAGE_SIZES_NARROW =
  "(max-width: 639px) 100vw, 50vw";

export function isListingCardFirstViewport(index: number): boolean {
  return index >= 0 && index < LISTING_CARD_FIRST_VIEWPORT_COUNT;
}

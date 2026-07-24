/** Selection-only city Place for profiles / KarPro (never lat/lng). */
export type PlaceSelection = {
  placeId: string;
  countryCode: string;
  label: string;
  city: string;
  region?: string;
};

/** True when placeId, 2-letter countryCode, and label are all present. */
export function isCompletePlaceSelection(
  value: PlaceSelection | null | undefined,
): value is PlaceSelection {
  if (value == null) return false;
  const placeId = value.placeId.trim();
  const countryCode = value.countryCode.trim().toUpperCase();
  const label = value.label.trim();
  return Boolean(placeId && countryCode.length === 2 && label);
}

/**
 * Fail-closed parse of a wire location object.
 * Accepts only a complete PlaceSelection; free-text strings and incomplete objects → null.
 */
export function parsePlaceSelection(raw: unknown): PlaceSelection | null {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  const placeId = typeof obj.placeId === "string" ? obj.placeId.trim() : "";
  const countryRaw = typeof obj.countryCode === "string" ? obj.countryCode.trim() : "";
  const countryCode = countryRaw.length === 2 ? countryRaw.toUpperCase() : "";
  const label = typeof obj.label === "string" ? obj.label.trim() : "";
  const cityRaw = typeof obj.city === "string" ? obj.city.trim() : "";
  const regionRaw = typeof obj.region === "string" ? obj.region.trim() : "";
  const city = cityRaw || label;
  const candidate: PlaceSelection = {
    placeId,
    countryCode,
    label,
    city,
    ...(regionRaw ? { region: regionRaw } : {}),
  };
  return isCompletePlaceSelection(candidate) ? candidate : null;
}

/** Emit wire object for kind 0 / KarPro Arweave (omit empty city/region duplicates). */
export function placeSelectionToWire(
  selection: PlaceSelection,
): Record<string, string> {
  const placeId = selection.placeId.trim();
  const countryCode = selection.countryCode.trim().toUpperCase();
  const label = selection.label.trim();
  const city = selection.city.trim();
  const region = selection.region?.trim() ?? "";
  const wire: Record<string, string> = {
    placeId,
    countryCode,
    label,
  };
  if (city) wire.city = city;
  if (region) wire.region = region;
  return wire;
}

/** Display label for UI (never coordinates). */
export function placeSelectionLabel(
  selection: PlaceSelection | null | undefined,
): string | null {
  if (!selection) return null;
  const label = selection.label.trim();
  if (label) return label;
  const city = selection.city.trim();
  const country = selection.countryCode.trim();
  if (city && country) return `${city}, ${country}`;
  if (city) return city;
  return null;
}

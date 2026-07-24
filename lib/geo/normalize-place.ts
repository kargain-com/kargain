import { buildPhotonOsmPlaceId } from "@/lib/geo/place-id";
import type { Place } from "@/lib/geo/types";

/** Layers accepted as city-level places without promotion. */
const CITY_LAYERS = new Set([
  "city",
  "town",
  "village",
  "municipality",
  "county",
]);

/** Layers that may promote to city when properties.city is present. */
const PROMOTE_LAYERS = new Set([
  "district",
  "locality",
  "suburb",
  "neighbourhood",
  "neighborhood",
]);

const REJECT_LAYERS = new Set(["house", "street"]);

export type PhotonFeatureLike = {
  type?: unknown;
  geometry?: {
    type?: unknown;
    coordinates?: unknown;
  };
  properties?: Record<string, unknown> | null;
};

/**
 * Fail-closed Photon GeoJSON feature → city-level Place.
 * GPS is never a Place; reverse suburb/district may promote via properties.city.
 */
export function normalizePhotonFeature(
  feature: PhotonFeatureLike,
): Place | null {
  const props = feature.properties;
  if (props == null || typeof props !== "object") return null;

  const coords = feature.geometry?.coordinates;
  if (!Array.isArray(coords) || coords.length < 2) return null;
  const lng = Number(coords[0]);
  const lat = Number(coords[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;

  const countryRaw = readString(props.countrycode);
  if (!countryRaw || countryRaw.length !== 2) return null;
  const countryCode = countryRaw.toUpperCase();

  const osmType = readString(props.osm_type);
  const osmId = props.osm_id;
  if (!osmType || osmId == null) return null;
  const placeId = buildPhotonOsmPlaceId(osmType, osmId as number | string);
  if (!placeId) return null;

  const layer = resolveLayer(props);
  if (REJECT_LAYERS.has(layer)) return null;

  const region = emptyToUndefined(readString(props.state));
  const countryName = emptyToUndefined(readString(props.country));

  let city: string | undefined;
  let effectiveLayer = layer;

  if (CITY_LAYERS.has(layer)) {
    city =
      emptyToUndefined(readString(props.city)) ??
      emptyToUndefined(readString(props.name));
  } else if (PROMOTE_LAYERS.has(layer)) {
    city = emptyToUndefined(readString(props.city));
    if (city) effectiveLayer = "city";
  } else {
    // Unknown / other: only accept when Photon already stamped a city name
    // and osm place semantics look settlement-like.
    const osmValue = (readString(props.osm_value) ?? "").toLowerCase();
    if (CITY_LAYERS.has(osmValue)) {
      city =
        emptyToUndefined(readString(props.city)) ??
        emptyToUndefined(readString(props.name));
      effectiveLayer = osmValue;
    }
  }

  if (!city) return null;

  const label = composeLabel({
    name: emptyToUndefined(readString(props.name)) ?? city,
    city,
    region,
    country: countryName,
    countryCode,
  });

  return {
    placeId,
    countryCode,
    label,
    city,
    ...(region ? { region } : {}),
    lat,
    lng,
    source: "photon",
    layer: effectiveLayer,
  };
}

function resolveLayer(props: Record<string, unknown>): string {
  const type = readString(props.type);
  if (type) return type.toLowerCase();
  const osmKey = (readString(props.osm_key) ?? "").toLowerCase();
  const osmValue = (readString(props.osm_value) ?? "").toLowerCase();
  if (osmKey === "place" && osmValue) return osmValue;
  if (osmValue) return osmValue;
  return "other";
}

function composeLabel(parts: {
  name: string;
  city: string;
  region?: string;
  country?: string;
  countryCode: string;
}): string {
  const segments: string[] = [];
  const head = parts.name.trim() || parts.city.trim();
  if (head) segments.push(head);
  if (
    parts.region &&
    parts.region.toLowerCase() !== head.toLowerCase()
  ) {
    segments.push(parts.region);
  }
  const country = parts.country?.trim() || parts.countryCode;
  if (
    country &&
    !segments.some((s) => s.toLowerCase() === country.toLowerCase())
  ) {
    segments.push(country);
  }
  return segments.join(", ");
}

function readString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function emptyToUndefined(value: string | undefined): string | undefined {
  return value && value.length > 0 ? value : undefined;
}

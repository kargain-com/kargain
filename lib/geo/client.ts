import { GeoError, type Place } from "@/lib/geo/types";

export type GeoClientSuggestQuery = {
  q: string;
  lang?: string;
};

export type GeoClientReverseQuery = {
  lat: number;
  lng: number;
  lang?: string;
};

type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

function buildSuggestUrl(query: GeoClientSuggestQuery): string {
  const params = new URLSearchParams();
  params.set("q", query.q.trim());
  if (query.lang) params.set("lang", query.lang);
  return `/api/geo/suggest?${params.toString()}`;
}

function buildReverseUrl(query: GeoClientReverseQuery): string {
  const params = new URLSearchParams();
  params.set("lat", String(query.lat));
  params.set("lng", String(query.lng));
  if (query.lang) params.set("lang", query.lang);
  return `/api/geo/reverse?${params.toString()}`;
}

async function readGeoJson(
  res: Response,
): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    throw new GeoError("parse", "Geo API response was not JSON");
  }
}

function mapHttpError(res: Response): never {
  if (res.status === 400) {
    throw new GeoError("invalid_query", "Invalid geo query");
  }
  throw new GeoError("upstream", `Geo API HTTP ${res.status}`);
}

/** Browser helper — calls same-origin `/api/geo/suggest` only. */
export async function suggestPlaces(
  query: GeoClientSuggestQuery,
  fetchFn: FetchLike = globalThis.fetch.bind(globalThis),
): Promise<Place[]> {
  const q = query.q.trim();
  if (!q) return [];

  const res = await fetchFn(buildSuggestUrl({ ...query, q }), {
    method: "GET",
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  if (!res.ok) mapHttpError(res);

  const body = await readGeoJson(res);
  if (body == null || typeof body !== "object") return [];
  const places = (body as { places?: unknown }).places;
  if (!Array.isArray(places)) return [];
  return places.filter(isPlace);
}

/** Browser helper — calls same-origin `/api/geo/reverse` only. */
export async function reversePlace(
  query: GeoClientReverseQuery,
  fetchFn: FetchLike = globalThis.fetch.bind(globalThis),
): Promise<Place | null> {
  const res = await fetchFn(buildReverseUrl(query), {
    method: "GET",
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  if (!res.ok) mapHttpError(res);

  const body = await readGeoJson(res);
  if (body == null || typeof body !== "object") return null;
  const place = (body as { place?: unknown }).place;
  if (place == null) return null;
  return isPlace(place) ? place : null;
}

export function buildGeoSuggestPath(query: GeoClientSuggestQuery): string {
  return buildSuggestUrl(query);
}

export function buildGeoReversePath(query: GeoClientReverseQuery): string {
  return buildReverseUrl(query);
}

function isPlace(value: unknown): value is Place {
  if (value == null || typeof value !== "object") return false;
  const p = value as Record<string, unknown>;
  return (
    typeof p.placeId === "string" &&
    typeof p.countryCode === "string" &&
    typeof p.label === "string" &&
    typeof p.city === "string" &&
    typeof p.lat === "number" &&
    typeof p.lng === "number" &&
    p.source === "photon" &&
    typeof p.layer === "string"
  );
}

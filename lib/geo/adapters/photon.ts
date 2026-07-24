import {
  normalizePhotonFeature,
  type PhotonFeatureLike,
} from "@/lib/geo/normalize-place";
import type { PlaceDirectory } from "@/lib/geo/ports";
import { resolvePhotonBaseUrl } from "@/lib/geo/photon-config";
import { GeoError, type Place } from "@/lib/geo/types";

const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_SUGGEST_LIMIT = 8;
const MAX_SUGGEST_LIMIT = 8;

/**
 * City-level layers on forward search.
 * Photon allowlist only: house, street, locality, district, city, county, state, country, other.
 * OSM town/village map to `locality` (not requestable as town/village/municipality).
 */
const SUGGEST_LAYERS = ["city", "locality"] as const;

export type PhotonFetch = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;

export type CreatePhotonPlaceDirectoryOptions = {
  baseUrl?: string;
  fetch?: PhotonFetch;
  timeoutMs?: number;
};

export function createPhotonPlaceDirectory(
  options: CreatePhotonPlaceDirectoryOptions = {},
): PlaceDirectory {
  const baseUrl = resolvePhotonBaseUrl(options.baseUrl);
  const fetchFn = options.fetch ?? globalThis.fetch.bind(globalThis);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return {
    async suggest(query) {
      const q = query.q.trim();
      if (!q) return [];

      const limit = clampLimit(query.limit);
      const url = new URL(`${baseUrl}/api`);
      url.searchParams.set("q", q);
      url.searchParams.set("limit", String(limit));
      for (const layer of SUGGEST_LAYERS) {
        url.searchParams.append("layer", layer);
      }
      if (query.lang) url.searchParams.set("lang", query.lang);

      const body = await fetchPhotonJson(fetchFn, url, timeoutMs);
      return mapFeatures(body).slice(0, limit);
    },

    async reverse(query) {
      if (
        !Number.isFinite(query.lat) ||
        !Number.isFinite(query.lng) ||
        query.lat < -90 ||
        query.lat > 90 ||
        query.lng < -180 ||
        query.lng > 180
      ) {
        throw new GeoError("invalid_query", "lat/lng out of range");
      }

      const url = new URL(`${baseUrl}/reverse`);
      url.searchParams.set("lat", String(query.lat));
      url.searchParams.set("lon", String(query.lng));
      // Several hits: first may be street/house; normalize keeps city-level only.
      url.searchParams.set("limit", "5");
      if (query.lang) url.searchParams.set("lang", query.lang);

      const body = await fetchPhotonJson(fetchFn, url, timeoutMs);
      const places = mapFeatures(body);
      return places[0] ?? null;
    },
  };
}

function clampLimit(raw: number | undefined): number {
  if (raw == null || !Number.isFinite(raw)) return DEFAULT_SUGGEST_LIMIT;
  const n = Math.floor(raw);
  if (n < 1) return 1;
  return Math.min(n, MAX_SUGGEST_LIMIT);
}

function mapFeatures(body: unknown): Place[] {
  if (body == null || typeof body !== "object") return [];
  const features = (body as { features?: unknown }).features;
  if (!Array.isArray(features)) return [];

  const out: Place[] = [];
  const seen = new Set<string>();
  for (const feature of features) {
    const place = normalizePhotonFeature(feature as PhotonFeatureLike);
    if (!place) continue;
    if (seen.has(place.placeId)) continue;
    seen.add(place.placeId);
    out.push(place);
  }
  return out;
}

async function fetchPhotonJson(
  fetchFn: PhotonFetch,
  url: URL,
  timeoutMs: number,
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetchFn(url.toString(), {
      method: "GET",
      headers: {
        Accept: "application/json",
        // Fair-use identification for public Photon (komoot ToS).
        "User-Agent": "KargainGeo/1.0 (https://kargain.com)",
      },
      signal: controller.signal,
      cache: "no-store",
    });

    if (!res.ok) {
      throw new GeoError(
        "upstream",
        `Photon HTTP ${res.status}`,
      );
    }

    try {
      return await res.json();
    } catch {
      throw new GeoError("parse", "Photon response was not JSON");
    }
  } catch (err) {
    if (err instanceof GeoError) throw err;
    if (isAbortError(err)) {
      throw new GeoError("timeout", "Photon request timed out");
    }
    throw new GeoError(
      "upstream",
      err instanceof Error ? err.message : "Photon request failed",
    );
  } finally {
    clearTimeout(timer);
  }
}

function isAbortError(err: unknown): boolean {
  if (err == null || typeof err !== "object") return false;
  const name = (err as { name?: string }).name;
  return name === "AbortError" || name === "TimeoutError";
}

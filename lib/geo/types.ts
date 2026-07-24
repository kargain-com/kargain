/** Canonical city-level place from a gazetteer (never raw GPS). */
export type Place = {
  placeId: string;
  countryCode: string;
  label: string;
  city: string;
  region?: string;
  lat: number;
  lng: number;
  source: "photon";
  layer: string;
};

export type PlaceSuggestQuery = {
  q: string;
  lang?: string;
  limit?: number;
};

export type PlaceReverseQuery = {
  lat: number;
  lng: number;
  lang?: string;
};

export type GeoErrorCode = "invalid_query" | "upstream" | "timeout" | "parse";

export class GeoError extends Error {
  readonly code: GeoErrorCode;

  constructor(code: GeoErrorCode, message: string) {
    super(message);
    this.name = "GeoError";
    this.code = code;
  }
}

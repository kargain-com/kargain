export type {
  Place,
  PlaceSuggestQuery,
  PlaceReverseQuery,
  GeoErrorCode,
} from "@/lib/geo/types";
export { GeoError } from "@/lib/geo/types";

export type { PlaceDirectory } from "@/lib/geo/ports";

export {
  buildPhotonOsmPlaceId,
  parsePhotonOsmPlaceId,
  type OsmElementType,
} from "@/lib/geo/place-id";

export {
  normalizePhotonFeature,
  type PhotonFeatureLike,
} from "@/lib/geo/normalize-place";

export {
  DEFAULT_PHOTON_BASE_URL,
  resolvePhotonBaseUrl,
} from "@/lib/geo/photon-config";

export {
  createPhotonPlaceDirectory,
  type CreatePhotonPlaceDirectoryOptions,
  type PhotonFetch,
} from "@/lib/geo/adapters/photon";

export {
  suggestPlaces,
  reversePlace,
  buildGeoSuggestPath,
  buildGeoReversePath,
  type GeoClientSuggestQuery,
  type GeoClientReverseQuery,
} from "@/lib/geo/client";

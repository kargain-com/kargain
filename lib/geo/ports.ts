import type {
  Place,
  PlaceReverseQuery,
  PlaceSuggestQuery,
} from "@/lib/geo/types";

/** Provider-agnostic city gazetteer. */
export type PlaceDirectory = {
  suggest(query: PlaceSuggestQuery): Promise<Place[]>;
  reverse(query: PlaceReverseQuery): Promise<Place | null>;
};

import type { NostrProfileData } from "@/lib/nostr/parse-profile-content";
import {
  isCompletePlaceSelection,
  type PlaceSelection,
} from "@/lib/geo/place-selection";

export type ProfileEditFieldKey =
  | "name"
  | "about"
  | "picture"
  | "website"
  | "lud16"
  | "location";

export type ProfileEditValues = {
  name: string;
  about: string;
  picture: string;
  website: string;
  lud16: string;
  location: PlaceSelection | null;
};

export function buildProfileEditPatch(
  touched: ReadonlySet<ProfileEditFieldKey>,
  values: ProfileEditValues,
  includeLud16: boolean,
  includeLocation: boolean,
): NostrProfileData {
  const patch: NostrProfileData = {};

  for (const key of ["name", "about", "picture", "website"] as const) {
    if (touched.has(key)) {
      patch[key] = values[key].trim() || undefined;
    }
  }

  if (includeLud16 && touched.has("lud16")) {
    patch.lud16 = values.lud16.trim() || undefined;
  }

  if (includeLocation && touched.has("location")) {
    const loc = values.location;
    patch.location =
      loc != null && isCompletePlaceSelection(loc) ? loc : null;
  }

  return patch;
}

import type { NostrProfileData } from "@/lib/nostr/parse-profile-content";

export type ProfileEditFieldKey = "name" | "about" | "picture" | "website" | "lud16";
export type ProfileEditValues = Record<ProfileEditFieldKey, string>;

export function buildProfileEditPatch(
  touched: ReadonlySet<ProfileEditFieldKey>,
  values: ProfileEditValues,
  includeLud16: boolean,
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

  return patch;
}

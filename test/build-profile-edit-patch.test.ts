import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildProfileEditPatch,
  type ProfileEditFieldKey,
  type ProfileEditValues,
} from "../lib/nostr/build-profile-edit-patch.ts";
import type { PlaceSelection } from "../lib/geo/place-selection.ts";

const PLACE: PlaceSelection = {
  placeId: "osm:R123",
  countryCode: "DE",
  label: "Berlin, Germany",
  city: "Berlin",
};

const ALL_VALUES: ProfileEditValues = {
  name: "Alice",
  about: "Bio",
  picture: "https://example.com/avatar.png",
  website: "https://example.com",
  lud16: "alice@example.com",
  location: PLACE,
};

describe("buildProfileEditPatch", () => {
  it("empty touched set yields empty patch", () => {
    const patch = buildProfileEditPatch(new Set(), ALL_VALUES, true, true);
    assert.equal(Object.keys(patch).length, 0);
  });

  it("untouched fields are absent from patch", () => {
    const touched = new Set<ProfileEditFieldKey>(["name"]);
    const patch = buildProfileEditPatch(touched, ALL_VALUES, true, true);

    assert.equal("name" in patch, true);
    assert.equal(patch.name, "Alice");
    assert.equal("about" in patch, false);
    assert.equal("picture" in patch, false);
    assert.equal("website" in patch, false);
    assert.equal("lud16" in patch, false);
    assert.equal("location" in patch, false);
  });

  it("touched empty field is present as undefined", () => {
    const touched = new Set<ProfileEditFieldKey>(["about"]);
    const patch = buildProfileEditPatch(
      touched,
      { ...ALL_VALUES, about: "" },
      true,
      true,
    );

    assert.equal("about" in patch, true);
    assert.equal(patch.about, undefined);
  });

  it("touched non-empty values are trimmed", () => {
    const touched = new Set<ProfileEditFieldKey>(["name"]);
    const patch = buildProfileEditPatch(
      touched,
      { ...ALL_VALUES, name: "  Bob  " },
      true,
      true,
    );

    assert.equal(patch.name, "Bob");
  });

  it("includeLud16 false excludes lud16 even when touched", () => {
    const touched = new Set<ProfileEditFieldKey>(["lud16"]);
    const patch = buildProfileEditPatch(touched, ALL_VALUES, false, true);

    assert.equal("lud16" in patch, false);
  });

  it("includeLocation false excludes location even when touched", () => {
    const touched = new Set<ProfileEditFieldKey>(["location"]);
    const patch = buildProfileEditPatch(touched, ALL_VALUES, true, false);

    assert.equal("location" in patch, false);
  });

  it("touched complete location is included", () => {
    const touched = new Set<ProfileEditFieldKey>(["location"]);
    const patch = buildProfileEditPatch(touched, ALL_VALUES, true, true);

    assert.deepEqual(patch.location, PLACE);
  });

  it("touched clear location is null", () => {
    const touched = new Set<ProfileEditFieldKey>(["location"]);
    const patch = buildProfileEditPatch(
      touched,
      { ...ALL_VALUES, location: null },
      true,
      true,
    );

    assert.equal("location" in patch, true);
    assert.equal(patch.location, null);
  });

  it("touched incomplete location clears to null", () => {
    const touched = new Set<ProfileEditFieldKey>(["location"]);
    const patch = buildProfileEditPatch(
      touched,
      {
        ...ALL_VALUES,
        location: {
          placeId: "",
          countryCode: "DE",
          label: "Berlin",
          city: "Berlin",
        },
      },
      true,
      true,
    );

    assert.equal(patch.location, null);
  });
});

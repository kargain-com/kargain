import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildProfileEditPatch,
  type ProfileEditFieldKey,
  type ProfileEditValues,
} from "../lib/nostr/build-profile-edit-patch.ts";

const ALL_VALUES: ProfileEditValues = {
  name: "Alice",
  about: "Bio",
  picture: "https://example.com/avatar.png",
  website: "https://example.com",
  lud16: "alice@example.com",
};

describe("buildProfileEditPatch", () => {
  it("empty touched set yields empty patch", () => {
    const patch = buildProfileEditPatch(new Set(), ALL_VALUES, true);
    assert.equal(Object.keys(patch).length, 0);
  });

  it("untouched fields are absent from patch", () => {
    const touched = new Set<ProfileEditFieldKey>(["name"]);
    const patch = buildProfileEditPatch(touched, ALL_VALUES, true);

    assert.equal("name" in patch, true);
    assert.equal(patch.name, "Alice");
    assert.equal("about" in patch, false);
    assert.equal("picture" in patch, false);
    assert.equal("website" in patch, false);
    assert.equal("lud16" in patch, false);
  });

  it("touched empty field is present as undefined", () => {
    const touched = new Set<ProfileEditFieldKey>(["about"]);
    const patch = buildProfileEditPatch(
      touched,
      { ...ALL_VALUES, about: "" },
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
    );

    assert.equal(patch.name, "Bob");
  });

  it("includeLud16 false excludes lud16 even when touched", () => {
    const touched = new Set<ProfileEditFieldKey>(["lud16"]);
    const patch = buildProfileEditPatch(touched, ALL_VALUES, false);

    assert.equal("lud16" in patch, false);
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  emptyPassportFormInput,
  emptyPassportMetadataBaseline,
  initialEditFormState,
} from "../lib/passport/metadata-form.ts";

describe("initialEditFormState", () => {
  it("uses empty form and baseline when metadata is null", () => {
    const state = initialEditFormState(null);
    assert.deepEqual(state.form, emptyPassportFormInput());
    assert.deepEqual(state.baseline, emptyPassportMetadataBaseline());
    assert.deepEqual(state.photoUris, []);
  });

  it("maps loaded metadata into form and keeps baseline photos", () => {
    const metadata = {
      version: "1.1" as const,
      vin: "1HGCM82633A004352",
      make: "Honda",
      model: "Accord",
      year: 2003,
      mileageKm: 120000,
      photos: ["ar://photo1"],
      description: "Test",
    };
    const state = initialEditFormState(metadata);
    assert.equal(state.form.vin, "1HGCM82633A004352");
    assert.equal(state.form.make, "Honda");
    assert.equal(state.baseline, metadata);
    assert.deepEqual(state.photoUris, ["ar://photo1"]);
  });
});

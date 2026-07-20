import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createInitialVinAssistState,
  planDecodeAutofill,
  planYearAutofill,
  vinAssistReducer,
  type DecodeFormSlice,
  type VinAssistState,
} from "../lib/passport/vin-assist.ts";
import type { VinDecodedFields } from "../lib/passport/vin-decode.ts";
import type { VinInsightOrigin } from "../lib/passport/vin-insight.ts";

const VIN_A = "1HGBH41JXMN109186";
const VIN_B = "1HGBH41JXMN109187";

const ORIGIN: VinInsightOrigin = {
  wmi: "1HG",
  manufacturer: "Honda",
  country: "United States",
};

function emptyFormSlice(
  overrides: Partial<DecodeFormSlice> = {},
): DecodeFormSlice {
  return {
    model: "",
    modelVariant: "",
    bodyType: "",
    fuelType: "",
    transmission: "",
    engine: "",
    ...overrides,
  };
}

function withMarkers(
  state: VinAssistState,
  markers: Iterable<keyof DecodeFormSlice>,
): VinAssistState {
  return { ...state, decodedMarkers: new Set(markers) };
}

describe("vinAssistReducer", () => {
  it("VIN_CHANGED clears origin, markers, and decode manualEdits", () => {
    let state = createInitialVinAssistState(VIN_A);
    state = vinAssistReducer(state, {
      type: "ORIGIN_RESOLVED",
      vin: VIN_A,
      origin: ORIGIN,
    });
    state = vinAssistReducer(state, {
      type: "DECODE_APPLIED",
      vin: VIN_A,
      markers: new Set(["model", "engine"]),
    });
    state = vinAssistReducer(state, {
      type: "DECODE_FIELD_MANUAL_EDIT",
      key: "fuelType",
    });
    state = vinAssistReducer(state, { type: "YEAR_APPLIED" });

    const next = vinAssistReducer(state, {
      type: "VIN_CHANGED",
      normalizedVin: VIN_B,
    });

    assert.equal(next.normalizedVin, VIN_B);
    assert.equal(next.origin, null);
    assert.equal(next.decodedMarkers.size, 0);
    assert.equal(next.manualEdits.size, 0);
    assert.equal(next.yearFromVin, true);
    assert.equal(next.yearManuallyEdited, false);
  });

  it("VIN_CHANGED is a no-op when normalizedVin is unchanged", () => {
    const state = createInitialVinAssistState(VIN_A);
    const withOrigin = vinAssistReducer(state, {
      type: "ORIGIN_RESOLVED",
      vin: VIN_A,
      origin: ORIGIN,
    });
    const next = vinAssistReducer(withOrigin, {
      type: "VIN_CHANGED",
      normalizedVin: VIN_A,
    });
    assert.equal(next, withOrigin);
  });

  it("ORIGIN_RESOLVED ignored when VIN mismatches", () => {
    const state = createInitialVinAssistState(VIN_A);
    const next = vinAssistReducer(state, {
      type: "ORIGIN_RESOLVED",
      vin: VIN_B,
      origin: ORIGIN,
    });
    assert.equal(next.origin, null);
    assert.equal(next, state);
  });

  it("DECODE_APPLIED ignored when VIN mismatches", () => {
    const state = createInitialVinAssistState(VIN_A);
    const next = vinAssistReducer(state, {
      type: "DECODE_APPLIED",
      vin: VIN_B,
      markers: new Set(["model"]),
    });
    assert.equal(next.decodedMarkers.size, 0);
    assert.equal(next, state);
  });

  it("YEAR_MANUAL_EDIT clears yearFromVin", () => {
    let state = createInitialVinAssistState(VIN_A);
    state = vinAssistReducer(state, { type: "YEAR_APPLIED" });
    state = vinAssistReducer(state, { type: "YEAR_MANUAL_EDIT" });
    assert.equal(state.yearManuallyEdited, true);
    assert.equal(state.yearFromVin, false);
  });

  it("DECODE_FIELD_MANUAL_EDIT removes marker and records edit", () => {
    let state = withMarkers(createInitialVinAssistState(VIN_A), ["model"]);
    state = vinAssistReducer(state, {
      type: "DECODE_FIELD_MANUAL_EDIT",
      key: "model",
    });
    assert.ok(state.manualEdits.has("model"));
    assert.ok(!state.decodedMarkers.has("model"));
  });

  it("DECODE_CLEARED empties markers", () => {
    let state = withMarkers(createInitialVinAssistState(VIN_A), ["model"]);
    state = vinAssistReducer(state, { type: "DECODE_CLEARED" });
    assert.equal(state.decodedMarkers.size, 0);
  });
});

describe("planYearAutofill", () => {
  it("fills only empty year and requests marker", () => {
    const state = createInitialVinAssistState(VIN_A);
    const plan = planYearAutofill(
      state,
      { yearSuggestion: 1991, yearConflict: false },
      "",
    );
    assert.deepEqual(plan, { write: "1991", applyMarker: true });
  });

  it("does not overwrite a filled year that is not from VIN", () => {
    const state = createInitialVinAssistState(VIN_A);
    const plan = planYearAutofill(
      state,
      { yearSuggestion: 1991, yearConflict: false },
      "2020",
    );
    assert.deepEqual(plan, { write: null, applyMarker: false });
  });

  it("manual year edit blocks later suggestions", () => {
    let state = createInitialVinAssistState(VIN_A);
    state = vinAssistReducer(state, { type: "YEAR_MANUAL_EDIT" });
    const plan = planYearAutofill(
      state,
      { yearSuggestion: 1991, yearConflict: false },
      "",
    );
    assert.deepEqual(plan, { write: null, applyMarker: false });
  });

  it("yearConflict never autofills", () => {
    const state = createInitialVinAssistState(VIN_A);
    const plan = planYearAutofill(
      state,
      { yearSuggestion: 1991, yearConflict: true },
      "",
    );
    assert.deepEqual(plan, { write: null, applyMarker: false });
  });

  it("null yearSuggestion never autofills", () => {
    const state = createInitialVinAssistState(VIN_A);
    const plan = planYearAutofill(
      state,
      { yearSuggestion: null, yearConflict: false },
      "",
    );
    assert.deepEqual(plan, { write: null, applyMarker: false });
  });

  it("while yearFromVin, changed suggestion re-syncs year", () => {
    let state = createInitialVinAssistState(VIN_A);
    state = vinAssistReducer(state, { type: "YEAR_APPLIED" });
    const plan = planYearAutofill(
      state,
      { yearSuggestion: 1992, yearConflict: false },
      "1991",
    );
    assert.deepEqual(plan, { write: "1992", applyMarker: true });
  });
});

describe("planDecodeAutofill", () => {
  const fields: VinDecodedFields = {
    model: "Civic",
    engine: "1.5T",
    fuelType: "Gasoline",
  };

  it("fills only empty fields and sets markers", () => {
    const state = createInitialVinAssistState(VIN_A);
    const plan = planDecodeAutofill(state, fields, emptyFormSlice());
    assert.equal(plan.writes.model, "Civic");
    assert.equal(plan.writes.engine, "1.5T");
    assert.equal(plan.writes.fuelType, "Gasoline");
    assert.ok(plan.markers.has("model"));
    assert.ok(plan.markers.has("engine"));
    assert.ok(plan.markers.has("fuelType"));
  });

  it("does not overwrite non-empty unmarked fields", () => {
    const state = createInitialVinAssistState(VIN_A);
    const plan = planDecodeAutofill(
      state,
      fields,
      emptyFormSlice({ model: "Accord" }),
    );
    assert.equal(plan.writes.model, undefined);
    assert.ok(!plan.markers.has("model"));
    assert.equal(plan.writes.engine, "1.5T");
  });

  it("manually edited field is never overwritten", () => {
    let state = createInitialVinAssistState(VIN_A);
    state = vinAssistReducer(state, {
      type: "DECODE_FIELD_MANUAL_EDIT",
      key: "model",
    });
    const plan = planDecodeAutofill(state, fields, emptyFormSlice());
    assert.equal(plan.writes.model, undefined);
    assert.ok(!plan.markers.has("model"));
    assert.equal(plan.writes.engine, "1.5T");
  });

  it("previously decoded unedited field re-syncs when decode result changes", () => {
    let state = withMarkers(createInitialVinAssistState(VIN_A), ["model"]);
    const plan = planDecodeAutofill(
      state,
      { model: "Integra" },
      emptyFormSlice({ model: "Civic" }),
    );
    assert.equal(plan.writes.model, "Integra");
    assert.ok(plan.markers.has("model"));
  });

  it("previously decoded field keeps marker when value already matches", () => {
    const state = withMarkers(createInitialVinAssistState(VIN_A), ["model"]);
    const plan = planDecodeAutofill(
      state,
      { model: "Civic" },
      emptyFormSlice({ model: "Civic" }),
    );
    assert.equal(plan.writes.model, undefined);
    assert.ok(plan.markers.has("model"));
  });
});

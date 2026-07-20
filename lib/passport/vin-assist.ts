import type {
  VinDecodedFieldKey,
  VinDecodedFields,
} from "@/lib/passport/vin-decode";
import type {
  VinInsight,
  VinInsightOrigin,
} from "@/lib/passport/vin-insight";

export const DECODE_FIELD_KEYS: readonly VinDecodedFieldKey[] = [
  "model",
  "modelVariant",
  "bodyType",
  "fuelType",
  "transmission",
  "engine",
] as const;

export type VinAssistState = {
  normalizedVin: string;
  origin: VinInsightOrigin | null;
  yearFromVin: boolean;
  yearManuallyEdited: boolean;
  decodedMarkers: ReadonlySet<VinDecodedFieldKey>;
  manualEdits: ReadonlySet<VinDecodedFieldKey>;
};

export type VinAssistAction =
  | { type: "VIN_CHANGED"; normalizedVin: string }
  | { type: "ORIGIN_RESOLVED"; vin: string; origin: VinInsightOrigin }
  | { type: "YEAR_APPLIED" }
  | { type: "YEAR_MANUAL_EDIT" }
  | { type: "DECODE_APPLIED"; vin: string; markers: ReadonlySet<VinDecodedFieldKey> }
  | { type: "DECODE_FIELD_MANUAL_EDIT"; key: VinDecodedFieldKey }
  | { type: "DECODE_CLEARED" };

export type YearAutofillPlan = {
  write: string | null;
  applyMarker: boolean;
};

export type DecodeFormSlice = Record<VinDecodedFieldKey, string>;

export type DecodeAutofillPlan = {
  writes: Partial<Record<VinDecodedFieldKey, string>>;
  markers: ReadonlySet<VinDecodedFieldKey>;
};

const EMPTY_MARKERS: ReadonlySet<VinDecodedFieldKey> = new Set();
const EMPTY_EDITS: ReadonlySet<VinDecodedFieldKey> = new Set();

export function createInitialVinAssistState(
  normalizedVin = "",
): VinAssistState {
  return {
    normalizedVin,
    origin: null,
    yearFromVin: false,
    yearManuallyEdited: false,
    decodedMarkers: EMPTY_MARKERS,
    manualEdits: EMPTY_EDITS,
  };
}

export function vinAssistReducer(
  state: VinAssistState,
  action: VinAssistAction,
): VinAssistState {
  switch (action.type) {
    case "VIN_CHANGED": {
      if (action.normalizedVin === state.normalizedVin) {
        return state;
      }
      return {
        ...state,
        normalizedVin: action.normalizedVin,
        origin: null,
        decodedMarkers: EMPTY_MARKERS,
        manualEdits: EMPTY_EDITS,
      };
    }
    case "ORIGIN_RESOLVED": {
      if (action.vin !== state.normalizedVin) return state;
      return { ...state, origin: action.origin };
    }
    case "YEAR_APPLIED":
      return { ...state, yearFromVin: true };
    case "YEAR_MANUAL_EDIT":
      return { ...state, yearManuallyEdited: true, yearFromVin: false };
    case "DECODE_APPLIED": {
      if (action.vin !== state.normalizedVin) return state;
      return { ...state, decodedMarkers: action.markers };
    }
    case "DECODE_FIELD_MANUAL_EDIT": {
      const nextEdits = new Set(state.manualEdits);
      nextEdits.add(action.key);
      if (!state.decodedMarkers.has(action.key)) {
        return { ...state, manualEdits: nextEdits };
      }
      const nextMarkers = new Set(state.decodedMarkers);
      nextMarkers.delete(action.key);
      return {
        ...state,
        manualEdits: nextEdits,
        decodedMarkers: nextMarkers,
      };
    }
    case "DECODE_CLEARED": {
      if (state.decodedMarkers.size === 0) return state;
      return { ...state, decodedMarkers: EMPTY_MARKERS };
    }
    default: {
      const _exhaustive: never = action;
      return _exhaustive;
    }
  }
}

export function planYearAutofill(
  state: VinAssistState,
  insight: Pick<VinInsight, "yearSuggestion" | "yearConflict">,
  yearField: string,
): YearAutofillPlan {
  if (state.yearManuallyEdited) {
    return { write: null, applyMarker: false };
  }
  if (insight.yearSuggestion == null || insight.yearConflict) {
    return { write: null, applyMarker: false };
  }

  const suggested = String(insight.yearSuggestion);
  if (!yearField.trim()) {
    return { write: suggested, applyMarker: true };
  }
  if (state.yearFromVin && yearField !== suggested) {
    return { write: suggested, applyMarker: true };
  }
  return { write: null, applyMarker: false };
}

export function planDecodeAutofill(
  state: VinAssistState,
  fields: VinDecodedFields,
  formSlice: DecodeFormSlice,
): DecodeAutofillPlan {
  const writes: Partial<Record<VinDecodedFieldKey, string>> = {};
  const nextMarkers = new Set<VinDecodedFieldKey>();

  for (const key of DECODE_FIELD_KEYS) {
    const decodedValue = fields[key];
    if (decodedValue == null) continue;
    if (state.manualEdits.has(key)) continue;

    const currentValue = formSlice[key].trim();

    if (!currentValue) {
      writes[key] = decodedValue;
      nextMarkers.add(key);
      continue;
    }

    if (state.decodedMarkers.has(key)) {
      if (currentValue !== decodedValue) {
        writes[key] = decodedValue;
      }
      nextMarkers.add(key);
    }
  }

  return { writes, markers: nextMarkers };
}

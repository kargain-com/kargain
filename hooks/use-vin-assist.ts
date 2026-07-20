"use client";

import { useEffect, useMemo, useReducer, useRef } from "react";

import { MAX_VIN_LENGTH, MIN_VIN_LENGTH } from "@/lib/passport/metadata-constants";
import { normalizeVin } from "@/lib/passport/metadata-schema";
import type {
  PassportCreateFormInput,
  PassportFormFieldKey,
} from "@/lib/passport/metadata-schema";
import {
  decodeVinFields,
  type VinDecodedFieldKey,
} from "@/lib/passport/vin-decode";
import {
  buildVinInsight,
  resolveVinOrigin,
} from "@/lib/passport/vin-insight";
import {
  createInitialVinAssistState,
  DECODE_FIELD_KEYS,
  planDecodeAutofill,
  planYearAutofill,
  vinAssistReducer,
  type DecodeFormSlice,
  type VinAssistAction,
  type VinAssistState,
} from "@/lib/passport/vin-assist";

const ORIGIN_RESOLVE_DEBOUNCE_MS = 300;
const DECODE_RESOLVE_DEBOUNCE_MS = 500;

type OnFieldChange = (key: PassportFormFieldKey, value: string) => void;

function parseYearField(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function decodeFormSlice(form: PassportCreateFormInput): DecodeFormSlice {
  return {
    model: form.model,
    modelVariant: form.modelVariant,
    bodyType: form.bodyType,
    fuelType: form.fuelType,
    transmission: form.transmission,
    engine: form.engine,
  };
}

function applyYearPlan(
  assistState: VinAssistState,
  rawVin: string,
  yearField: string,
  onFieldChange: OnFieldChange,
  dispatch: (action: VinAssistAction) => void,
) {
  const insight = buildVinInsight(rawVin, yearField);
  const plan = planYearAutofill(assistState, insight, yearField);
  if (plan.write != null) {
    onFieldChange("year", plan.write);
  }
  if (plan.applyMarker) {
    dispatch({ type: "YEAR_APPLIED" });
  }
}

export function useVinAssist({
  form,
  onFieldChange,
}: {
  form: PassportCreateFormInput;
  onFieldChange: OnFieldChange;
}) {
  const [state, dispatch] = useReducer(
    vinAssistReducer,
    form.vin,
    (vin) => createInitialVinAssistState(normalizeVin(vin)),
  );

  const formRef = useRef(form);
  const onFieldChangeRef = useRef(onFieldChange);
  const stateRef = useRef(state);

  const normalizedFromForm = normalizeVin(form.vin);
  const effectiveState =
    normalizedFromForm !== state.normalizedVin
      ? vinAssistReducer(state, {
          type: "VIN_CHANGED",
          normalizedVin: normalizedFromForm,
        })
      : state;
  if (effectiveState !== state) {
    dispatch({ type: "VIN_CHANGED", normalizedVin: normalizedFromForm });
  }

  useEffect(() => {
    formRef.current = form;
    onFieldChangeRef.current = onFieldChange;
    stateRef.current = effectiveState;
  });

  const insight = useMemo(
    () => (form.vin.trim() ? buildVinInsight(form.vin, form.year) : null),
    [form.vin, form.year],
  );

  const canDecode =
    effectiveState.normalizedVin.length === MAX_VIN_LENGTH &&
    (insight?.status === "ok" || insight?.status === "warning");

  useEffect(() => {
    if (effectiveState.normalizedVin.length < MIN_VIN_LENGTH) {
      return;
    }

    let cancelled = false;
    const vinAtResolve = effectiveState.normalizedVin;
    const timer = window.setTimeout(() => {
      void resolveVinOrigin(vinAtResolve).then((origin) => {
        if (cancelled) return;
        if (normalizeVin(formRef.current.vin) !== vinAtResolve) return;
        if (origin == null) return;
        dispatch({
          type: "ORIGIN_RESOLVED",
          vin: vinAtResolve,
          origin,
        });
      });
    }, ORIGIN_RESOLVE_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [effectiveState.normalizedVin]);

  useEffect(() => {
    if (!canDecode) {
      return;
    }

    let cancelled = false;
    const vinAtResolve = effectiveState.normalizedVin;
    const yearHint =
      parseYearField(form.year) ?? insight?.yearSuggestion ?? null;

    const timer = window.setTimeout(() => {
      void decodeVinFields(vinAtResolve, yearHint).then((fields) => {
        if (cancelled) return;
        if (normalizeVin(formRef.current.vin) !== vinAtResolve) return;
        if (!fields) return;

        const plan = planDecodeAutofill(
          stateRef.current,
          fields,
          decodeFormSlice(formRef.current),
        );

        for (const key of DECODE_FIELD_KEYS) {
          const value = plan.writes[key];
          if (value != null) {
            onFieldChangeRef.current(key, value);
          }
        }

        dispatch({
          type: "DECODE_APPLIED",
          vin: vinAtResolve,
          markers: plan.markers,
        });
      });
    }, DECODE_RESOLVE_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    canDecode,
    effectiveState.normalizedVin,
    insight?.yearSuggestion,
    form.year,
  ]);

  const onVinChange = (value: string) => {
    onFieldChange("vin", value);
    const normalizedVin = normalizeVin(value);
    const nextState = vinAssistReducer(effectiveState, {
      type: "VIN_CHANGED",
      normalizedVin,
    });
    dispatch({ type: "VIN_CHANGED", normalizedVin });
    applyYearPlan(nextState, value, form.year, onFieldChange, dispatch);
  };

  const onYearChange = (value: string) => {
    dispatch({ type: "YEAR_MANUAL_EDIT" });
    onFieldChange("year", value);
  };

  const onDecodedFieldChange = (key: VinDecodedFieldKey, value: string) => {
    dispatch({ type: "DECODE_FIELD_MANUAL_EDIT", key });
    onFieldChange(key, value);
  };

  const displayedMarkers = canDecode ? effectiveState.decodedMarkers : null;

  const isDecoded = (key: VinDecodedFieldKey) =>
    displayedMarkers != null && displayedMarkers.has(key);

  return {
    insight,
    origin: effectiveState.origin,
    yearFromVin: effectiveState.yearFromVin,
    isDecoded,
    onVinChange,
    onYearChange,
    onDecodedFieldChange,
  };
}

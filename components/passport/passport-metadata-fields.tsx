"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  MAX_DESCRIPTION,
  MAX_VIN_LENGTH,
  MIN_VIN_LENGTH,
  MIN_YEAR,
} from "@/lib/passport/metadata-constants";
import {
  BODY_TYPE_OPTIONS,
  CONDITION_OPTIONS,
  FUEL_TYPE_OPTIONS,
  TRANSMISSION_OPTIONS,
  VEHICLE_TYPE_OPTIONS,
} from "@/lib/passport/metadata-form-options";
import type {
  PassportCreateFormErrors,
  PassportCreateFormInput,
  PassportFormFieldKey,
} from "@/lib/passport/metadata-schema";
import { normalizeVin } from "@/lib/passport/metadata-schema";
import {
  decodeVinFields,
  type VinDecodedFieldKey,
} from "@/lib/passport/vin-decode";
import {
  buildVinInsight,
  resolveVinOrigin,
  type VinInsightOrigin,
} from "@/lib/passport/vin-insight";

const ORIGIN_RESOLVE_DEBOUNCE_MS = 300;
const DECODE_RESOLVE_DEBOUNCE_MS = 500;

const DECODE_FIELD_KEYS: readonly VinDecodedFieldKey[] = [
  "model",
  "modelVariant",
  "bodyType",
  "fuelType",
  "transmission",
  "engine",
] as const;

type Props = {
  form: PassportCreateFormInput;
  errors: PassportCreateFormErrors;
  disabled?: boolean;
  onFieldChange: (key: PassportFormFieldKey, value: string) => void;
  showCore?: boolean;
  showOptional?: boolean;
};

function formatOriginCountry(country: string): string {
  if (!country) return "";
  const primary = country.split("(")[0]?.trim() ?? country;
  return primary
    .toLowerCase()
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function parseYearField(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function OptionalSelect({
  id,
  label,
  value,
  options,
  disabled,
  decoded,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  options: readonly string[];
  disabled?: boolean;
  decoded?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-baseline gap-2">
        <Label htmlFor={id}>{label}</Label>
        {decoded && (
          <span className="font-mono text-xs text-text-tertiary">Decoded</span>
        )}
      </div>
      <Select
        value={value || "__none__"}
        onValueChange={(next) => onChange(next === "__none__" ? "" : next)}
        disabled={disabled}
      >
        <SelectTrigger id={id}>
          <SelectValue placeholder={`Select ${label.toLowerCase()}`} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__none__">—</SelectItem>
          {options.map((opt) => (
            <SelectItem key={opt} value={opt}>
              {opt}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export function PassportMetadataFields({
  form,
  errors,
  disabled,
  onFieldChange,
  showCore = true,
  showOptional = true,
}: Props) {
  const maxYear = new Date().getFullYear() + 1;
  const yearManuallyEditedRef = useRef(false);
  const decodeManuallyEditedRef = useRef(new Set<VinDecodedFieldKey>());
  const decodedMarkersRef = useRef(new Set<VinDecodedFieldKey>());
  const formRef = useRef(form);
  formRef.current = form;
  const [vinOrigin, setVinOrigin] = useState<VinInsightOrigin | null>(null);
  const [yearFromVin, setYearFromVin] = useState(false);
  const [decodedMarkers, setDecodedMarkers] = useState(
    () => new Set<VinDecodedFieldKey>(),
  );

  const vinInsight = useMemo(() => {
    if (!form.vin.trim()) return null;
    return buildVinInsight(form.vin, form.year);
  }, [form.vin, form.year]);

  const normalizedVin = useMemo(() => normalizeVin(form.vin), [form.vin]);

  useEffect(() => {
    if (normalizedVin.length < MIN_VIN_LENGTH) {
      setVinOrigin(null);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      const vinAtResolve = normalizedVin;
      void resolveVinOrigin(vinAtResolve).then((origin) => {
        if (cancelled || normalizeVin(form.vin) !== vinAtResolve) return;
        setVinOrigin(origin);
      });
    }, ORIGIN_RESOLVE_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [normalizedVin, form.vin]);

  useEffect(() => {
    if (!vinInsight || yearManuallyEditedRef.current) return;

    const { yearSuggestion, yearConflict } = vinInsight;
    if (yearSuggestion == null || yearConflict) return;

    const suggested = String(yearSuggestion);
    if (!form.year.trim()) {
      onFieldChange("year", suggested);
      setYearFromVin(true);
      return;
    }

    if (yearFromVin && form.year !== suggested) {
      onFieldChange("year", suggested);
    }
  }, [vinInsight, form.year, yearFromVin, onFieldChange]);

  useEffect(() => {
    const status = vinInsight?.status;
    const canDecode =
      normalizedVin.length === MAX_VIN_LENGTH &&
      (status === "ok" || status === "warning");

    if (!canDecode) {
      if (decodedMarkersRef.current.size > 0) {
        decodedMarkersRef.current = new Set();
        setDecodedMarkers(new Set());
      }
      return;
    }

    let cancelled = false;
    const vinAtResolve = normalizedVin;
    const yearHint =
      parseYearField(form.year) ?? vinInsight?.yearSuggestion ?? null;

    const timer = window.setTimeout(() => {
      void decodeVinFields(vinAtResolve, yearHint).then((fields) => {
        if (cancelled || normalizeVin(formRef.current.vin) !== vinAtResolve) {
          return;
        }
        if (!fields) return;

        const nextMarkers = new Set<VinDecodedFieldKey>();
        const current = formRef.current;
        const wasDecoded = decodedMarkersRef.current;

        for (const key of DECODE_FIELD_KEYS) {
          const decodedValue = fields[key];
          if (decodedValue == null) continue;
          if (decodeManuallyEditedRef.current.has(key)) continue;

          const currentValue = current[key].trim();

          if (!currentValue) {
            onFieldChange(key, decodedValue);
            nextMarkers.add(key);
            continue;
          }

          if (wasDecoded.has(key)) {
            if (currentValue !== decodedValue) {
              onFieldChange(key, decodedValue);
            }
            nextMarkers.add(key);
          }
        }

        decodedMarkersRef.current = nextMarkers;
        setDecodedMarkers(nextMarkers);
      });
    }, DECODE_RESOLVE_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    normalizedVin,
    vinInsight?.status,
    vinInsight?.yearSuggestion,
    form.year,
    onFieldChange,
  ]);

  const handleVinChange = (value: string) => {
    onFieldChange("vin", value);
  };

  const handleYearChange = (value: string) => {
    yearManuallyEditedRef.current = true;
    setYearFromVin(false);
    onFieldChange("year", value);
  };

  const markDecodedFieldEdited = (key: VinDecodedFieldKey) => {
    decodeManuallyEditedRef.current.add(key);
    if (!decodedMarkersRef.current.has(key)) return;
    const next = new Set(decodedMarkersRef.current);
    next.delete(key);
    decodedMarkersRef.current = next;
    setDecodedMarkers(next);
  };

  const handleDecodedTextChange = (key: VinDecodedFieldKey, value: string) => {
    markDecodedFieldEdited(key);
    onFieldChange(key, value);
  };

  const handleDecodedSelectChange = (key: VinDecodedFieldKey, value: string) => {
    markDecodedFieldEdited(key);
    onFieldChange(key, value);
  };

  const isDecoded = (key: VinDecodedFieldKey) => decodedMarkers.has(key);

  const insightHardErrors =
    vinInsight?.status === "error" ? vinInsight.messages : [];
  const insightAdvisories =
    vinInsight?.status === "warning" || vinInsight?.status === "incomplete"
      ? vinInsight.messages
      : [];

  return (
    <div className="space-y-6">
      {showCore && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="vin">VIN</Label>
            <Input
              id="vin"
              name="vin"
              value={form.vin}
              onChange={(e) => handleVinChange(e.target.value)}
              placeholder="17-character VIN"
              maxLength={17}
              autoComplete="off"
              disabled={disabled}
            />
            {errors.vin && <p className="text-xs text-status-error">{errors.vin}</p>}
            {insightHardErrors.map((message) => (
              <p key={message} className="text-xs text-status-error">
                {message}
              </p>
            ))}
            {insightAdvisories.map((message) => (
              <p key={message} className="text-xs text-status-warning">
                {message}
              </p>
            ))}
            {vinOrigin && (
              <p className="font-mono text-xs tabular-nums text-text-tertiary">
                <span className="font-sans text-text-secondary">From VIN · </span>
                {vinOrigin.wmi} · {vinOrigin.manufacturer} ·{" "}
                {formatOriginCountry(vinOrigin.country)}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="make">Make</Label>
            <Input
              id="make"
              name="make"
              value={form.make}
              onChange={(e) => onFieldChange("make", e.target.value)}
              placeholder="e.g. Toyota"
              disabled={disabled}
            />
            {errors.make && <p className="text-xs text-status-error">{errors.make}</p>}
          </div>

          <div className="space-y-2">
            <div className="flex items-baseline gap-2">
              <Label htmlFor="model">Model</Label>
              {isDecoded("model") && (
                <span className="font-mono text-xs text-text-tertiary">Decoded</span>
              )}
            </div>
            <Input
              id="model"
              name="model"
              value={form.model}
              onChange={(e) => handleDecodedTextChange("model", e.target.value)}
              placeholder="e.g. Corolla"
              disabled={disabled}
            />
            {errors.model && <p className="text-xs text-status-error">{errors.model}</p>}
          </div>

          <div className="space-y-2">
            <div className="flex items-baseline gap-2">
              <Label htmlFor="year">Year</Label>
              {yearFromVin && (
                <span className="font-mono text-xs text-text-tertiary">From VIN</span>
              )}
            </div>
            <Input
              id="year"
              name="year"
              type="number"
              inputMode="numeric"
              value={form.year}
              onChange={(e) => handleYearChange(e.target.value)}
              placeholder="2020"
              min={MIN_YEAR}
              max={maxYear}
              disabled={disabled}
            />
            {errors.year && <p className="text-xs text-status-error">{errors.year}</p>}
            {vinInsight?.yearConflict && vinInsight.yearSuggestion != null && (
              <p className="text-xs text-status-warning">
                VIN suggests {vinInsight.yearSuggestion}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="mileage">Mileage (km)</Label>
            <Input
              id="mileage"
              name="mileage"
              type="number"
              inputMode="numeric"
              value={form.mileage}
              onChange={(e) => onFieldChange("mileage", e.target.value)}
              placeholder="85000"
              min={0}
              disabled={disabled}
            />
            {errors.mileage && <p className="text-xs text-status-error">{errors.mileage}</p>}
          </div>
        </div>
      )}

      {showOptional && (
        <div className="space-y-4 border-t border-border-default pt-6">
          <div>
            <p className="font-sans text-sm font-medium text-text-primary">
              Vehicle details (optional)
            </p>
            <p className="mt-1 font-sans text-xs text-text-secondary">
              Enrich the passport for marketplace filters and buyer trust.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="type">Type</Label>
              <Input
                id="type"
                value={form.type}
                onChange={(e) => onFieldChange("type", e.target.value)}
                placeholder="e.g. EV, Saloon"
                disabled={disabled}
              />
            </div>

            <OptionalSelect
              id="vehicleType"
              label="Vehicle type"
              value={form.vehicleType}
              options={VEHICLE_TYPE_OPTIONS}
              disabled={disabled}
              onChange={(value) => onFieldChange("vehicleType", value)}
            />

            <div className="space-y-2">
              <div className="flex items-baseline gap-2">
                <Label htmlFor="modelVariant">Variant</Label>
                {isDecoded("modelVariant") && (
                  <span className="font-mono text-xs text-text-tertiary">Decoded</span>
                )}
              </div>
              <Input
                id="modelVariant"
                value={form.modelVariant}
                onChange={(e) =>
                  handleDecodedTextChange("modelVariant", e.target.value)
                }
                placeholder="e.g. Long Range"
                disabled={disabled}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="colour">Colour</Label>
              <Input
                id="colour"
                value={form.colour}
                onChange={(e) => onFieldChange("colour", e.target.value)}
                placeholder="e.g. Blue"
                disabled={disabled}
              />
            </div>

            <OptionalSelect
              id="fuelType"
              label="Fuel"
              value={form.fuelType}
              options={FUEL_TYPE_OPTIONS}
              disabled={disabled}
              decoded={isDecoded("fuelType")}
              onChange={(value) => handleDecodedSelectChange("fuelType", value)}
            />

            <OptionalSelect
              id="bodyType"
              label="Body type"
              value={form.bodyType}
              options={BODY_TYPE_OPTIONS}
              disabled={disabled}
              decoded={isDecoded("bodyType")}
              onChange={(value) => handleDecodedSelectChange("bodyType", value)}
            />

            <OptionalSelect
              id="transmission"
              label="Transmission"
              value={form.transmission}
              options={TRANSMISSION_OPTIONS}
              disabled={disabled}
              decoded={isDecoded("transmission")}
              onChange={(value) =>
                handleDecodedSelectChange("transmission", value)
              }
            />

            <div className="space-y-2">
              <Label htmlFor="power">Power</Label>
              <Input
                id="power"
                value={form.power}
                onChange={(e) => onFieldChange("power", e.target.value)}
                placeholder="e.g. 150 kW"
                disabled={disabled}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="evBatteryKwh">EV battery (kWh)</Label>
              <Input
                id="evBatteryKwh"
                type="number"
                inputMode="decimal"
                value={form.evBatteryKwh}
                onChange={(e) => onFieldChange("evBatteryKwh", e.target.value)}
                placeholder="75"
                min={0}
                step="0.1"
                disabled={disabled}
              />
              {errors.evBatteryKwh && (
                <p className="text-xs text-status-error">{errors.evBatteryKwh}</p>
              )}
            </div>

            <div className="space-y-2">
              <div className="flex items-baseline gap-2">
                <Label htmlFor="engine">Engine</Label>
                {isDecoded("engine") && (
                  <span className="font-mono text-xs text-text-tertiary">Decoded</span>
                )}
              </div>
              <Input
                id="engine"
                value={form.engine}
                onChange={(e) => handleDecodedTextChange("engine", e.target.value)}
                placeholder="e.g. 2.0 TDI"
                disabled={disabled}
              />
            </div>

            <OptionalSelect
              id="condition"
              label="Condition"
              value={form.condition}
              options={CONDITION_OPTIONS}
              disabled={disabled}
              onChange={(value) => onFieldChange("condition", value)}
            />

            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="features">Features</Label>
              <Input
                id="features"
                value={form.features}
                onChange={(e) => onFieldChange("features", e.target.value)}
                placeholder="Comma-separated, e.g. Sunroof, Leather seats"
                disabled={disabled}
              />
            </div>

            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="locationLabel">Location</Label>
              <Input
                id="locationLabel"
                value={form.locationLabel}
                onChange={(e) => onFieldChange("locationLabel", e.target.value)}
                placeholder="City, region, country — e.g. Berlin, Germany"
                disabled={disabled}
              />
            </div>
          </div>
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor="description">Description (optional)</Label>
        <Textarea
          id="description"
          name="description"
          value={form.description}
          onChange={(e) => onFieldChange("description", e.target.value)}
          placeholder="Short note about condition or history"
          maxLength={MAX_DESCRIPTION}
          rows={4}
          disabled={disabled}
        />
        <p className="text-xs text-text-secondary">
          {form.description.length}/{MAX_DESCRIPTION}
        </p>
        {errors.description && (
          <p className="text-xs text-status-error">{errors.description}</p>
        )}
      </div>
    </div>
  );
}

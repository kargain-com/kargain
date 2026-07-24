"use client";

import { PlacePicker } from "@/components/geo/place-picker";
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
import { useVinAssist } from "@/hooks/use-vin-assist";
import {
  MAX_DESCRIPTION,
  MIN_YEAR,
} from "@/lib/passport/metadata-constants";
import {
  BODY_TYPE_OPTIONS,
  CONDITION_OPTIONS,
  FUEL_TYPE_OPTIONS,
  TRANSMISSION_OPTIONS,
  VEHICLE_TYPE_OPTIONS,
} from "@/lib/passport/metadata-form-options";
import {
  locationFieldsFromSelection,
  locationSelectionFromForm,
  type PassportCreateFormErrors,
  type PassportCreateFormInput,
  type PassportFormFieldKey,
  type PassportLocationSelection,
} from "@/lib/passport/metadata-schema";
import type { VinDecodedFieldKey } from "@/lib/passport/vin-decode";
import type { VinInsightOrigin } from "@/lib/passport/vin-insight";

type Props = {
  form: PassportCreateFormInput;
  errors: PassportCreateFormErrors;
  disabled?: boolean;
  onFieldChange: (key: PassportFormFieldKey, value: string) => void;
  showCore?: boolean;
  showOptional?: boolean;
};

function applyLocationSelection(
  selection: PassportLocationSelection | null,
  onFieldChange: (key: PassportFormFieldKey, value: string) => void,
) {
  const fields = locationFieldsFromSelection(selection);
  onFieldChange("locationLabel", fields.locationLabel);
  onFieldChange("locationPlaceId", fields.locationPlaceId);
  onFieldChange("locationCountryCode", fields.locationCountryCode);
  onFieldChange("locationCity", fields.locationCity);
  onFieldChange("locationRegion", fields.locationRegion);
}

function formatOriginCountry(country: string): string {
  if (!country) return "";
  const primary = country.split("(")[0]?.trim() ?? country;
  return primary
    .toLowerCase()
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function OriginLine({ origin }: { origin: VinInsightOrigin }) {
  return (
    <p className="font-mono text-xs tabular-nums text-text-tertiary">
      <span className="font-sans text-text-secondary">From VIN · </span>
      {origin.wmi} · {origin.manufacturer} ·{" "}
      {formatOriginCountry(origin.country)}
    </p>
  );
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

function DecodedLabel({
  htmlFor,
  children,
  decoded,
}: {
  htmlFor: string;
  children: string;
  decoded: boolean;
}) {
  return (
    <div className="flex items-baseline gap-2">
      <Label htmlFor={htmlFor}>{children}</Label>
      {decoded && (
        <span className="font-mono text-xs text-text-tertiary">Decoded</span>
      )}
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
  const {
    insight,
    origin,
    yearFromVin,
    isDecoded,
    onVinChange,
    onYearChange,
    onDecodedFieldChange,
  } = useVinAssist({ form, onFieldChange });

  const insightHardErrors =
    insight?.status === "error" ? insight.messages : [];
  const insightAdvisories =
    insight?.status === "warning" || insight?.status === "incomplete"
      ? insight.messages
      : [];

  const handleDecodedTextChange = (key: VinDecodedFieldKey, value: string) => {
    onDecodedFieldChange(key, value);
  };

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
              onChange={(e) => onVinChange(e.target.value)}
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
            {origin && <OriginLine origin={origin} />}
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
            <DecodedLabel htmlFor="model" decoded={isDecoded("model")}>
              Model
            </DecodedLabel>
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
              onChange={(e) => onYearChange(e.target.value)}
              placeholder="2020"
              min={MIN_YEAR}
              max={maxYear}
              disabled={disabled}
            />
            {errors.year && <p className="text-xs text-status-error">{errors.year}</p>}
            {insight?.yearConflict && insight.yearSuggestion != null && (
              <p className="text-xs text-status-warning">
                VIN suggests {insight.yearSuggestion}
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
              <DecodedLabel
                htmlFor="modelVariant"
                decoded={isDecoded("modelVariant")}
              >
                Variant
              </DecodedLabel>
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
              onChange={(value) => onDecodedFieldChange("fuelType", value)}
            />

            <OptionalSelect
              id="bodyType"
              label="Body type"
              value={form.bodyType}
              options={BODY_TYPE_OPTIONS}
              disabled={disabled}
              decoded={isDecoded("bodyType")}
              onChange={(value) => onDecodedFieldChange("bodyType", value)}
            />

            <OptionalSelect
              id="transmission"
              label="Transmission"
              value={form.transmission}
              options={TRANSMISSION_OPTIONS}
              disabled={disabled}
              decoded={isDecoded("transmission")}
              onChange={(value) => onDecodedFieldChange("transmission", value)}
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
              <DecodedLabel htmlFor="engine" decoded={isDecoded("engine")}>
                Engine
              </DecodedLabel>
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

            <div className="sm:col-span-2">
              <PlacePicker
                id="locationLabel"
                value={locationSelectionFromForm(form)}
                onChange={(selection) =>
                  applyLocationSelection(selection, onFieldChange)
                }
                disabled={disabled}
                error={errors.locationLabel}
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

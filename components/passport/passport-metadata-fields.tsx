"use client";

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
import { MAX_DESCRIPTION, MIN_YEAR } from "@/lib/passport/metadata-constants";
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

type Props = {
  form: PassportCreateFormInput;
  errors: PassportCreateFormErrors;
  disabled?: boolean;
  onFieldChange: (key: PassportFormFieldKey, value: string) => void;
  showCore?: boolean;
  showOptional?: boolean;
};

function OptionalSelect({
  id,
  label,
  value,
  options,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  options: readonly string[];
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
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
              onChange={(e) => onFieldChange("vin", e.target.value)}
              placeholder="17-character VIN"
              maxLength={17}
              autoComplete="off"
              disabled={disabled}
            />
            {errors.vin && <p className="text-xs text-status-error">{errors.vin}</p>}
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
            <Label htmlFor="model">Model</Label>
            <Input
              id="model"
              name="model"
              value={form.model}
              onChange={(e) => onFieldChange("model", e.target.value)}
              placeholder="e.g. Corolla"
              disabled={disabled}
            />
            {errors.model && <p className="text-xs text-status-error">{errors.model}</p>}
          </div>

          <div className="space-y-2">
            <Label htmlFor="year">Year</Label>
            <Input
              id="year"
              name="year"
              type="number"
              inputMode="numeric"
              value={form.year}
              onChange={(e) => onFieldChange("year", e.target.value)}
              placeholder="2020"
              min={MIN_YEAR}
              max={maxYear}
              disabled={disabled}
            />
            {errors.year && <p className="text-xs text-status-error">{errors.year}</p>}
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
              <Label htmlFor="modelVariant">Variant</Label>
              <Input
                id="modelVariant"
                value={form.modelVariant}
                onChange={(e) => onFieldChange("modelVariant", e.target.value)}
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
              onChange={(value) => onFieldChange("fuelType", value)}
            />

            <OptionalSelect
              id="bodyType"
              label="Body type"
              value={form.bodyType}
              options={BODY_TYPE_OPTIONS}
              disabled={disabled}
              onChange={(value) => onFieldChange("bodyType", value)}
            />

            <OptionalSelect
              id="transmission"
              label="Transmission"
              value={form.transmission}
              options={TRANSMISSION_OPTIONS}
              disabled={disabled}
              onChange={(value) => onFieldChange("transmission", value)}
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
              <Label htmlFor="engine">Engine</Label>
              <Input
                id="engine"
                value={form.engine}
                onChange={(e) => onFieldChange("engine", e.target.value)}
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

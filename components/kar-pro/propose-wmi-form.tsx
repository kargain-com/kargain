"use client";

import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { SpinnerIcon } from "@/components/ui/icons";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type {
  ProposalFormFields,
  ProposalSubmitOutcome,
} from "@/hooks/use-commons-actions";
import { categoryLabel } from "@/lib/design/instrument-classes";

/**
 * Inline propose-from-document form. The document itself is never uploaded
 * or described beyond the sighting confirmation (PII, PROTOCOL §4.7).
 */
export function ProposeWmiForm({
  wmi,
  pending,
  onSubmit,
  onClose,
}: {
  wmi: string;
  pending: boolean;
  onSubmit: (fields: ProposalFormFields) => Promise<ProposalSubmitOutcome>;
  onClose: () => void;
}) {
  const [manufacturer, setManufacturer] = useState("");
  const [country, setCountry] = useState("");
  const [vehicleType, setVehicleType] = useState("");
  const [sighted, setSighted] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const canSubmit = manufacturer.trim().length > 0 && sighted && !pending;

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit) return;
    setFormError(null);
    const outcome = await onSubmit({ manufacturer, country, vehicleType });
    if (outcome.ok) {
      onClose();
      return;
    }
    if (outcome.message) {
      setFormError(outcome.message);
    }
  };

  return (
    <form
      onSubmit={(event) => void handleSubmit(event)}
      className="space-y-3 rounded-sm border border-border-default p-3"
    >
      <p className={categoryLabel}>Propose from document</p>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor={`wmi-manufacturer-${wmi}`}>Manufacturer</Label>
          <Input
            id={`wmi-manufacturer-${wmi}`}
            value={manufacturer}
            onChange={(event) => setManufacturer(event.target.value)}
            placeholder="Legal manufacturer"
            disabled={pending}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`wmi-country-${wmi}`}>Country</Label>
          <Input
            id={`wmi-country-${wmi}`}
            value={country}
            onChange={(event) => setCountry(event.target.value)}
            placeholder="e.g. DE"
            maxLength={2}
            className="font-mono uppercase"
            disabled={pending}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`wmi-vehicle-type-${wmi}`}>Vehicle type</Label>
          <Input
            id={`wmi-vehicle-type-${wmi}`}
            value={vehicleType}
            onChange={(event) => setVehicleType(event.target.value)}
            placeholder="e.g. Passenger car"
            disabled={pending}
          />
        </div>
      </div>

      <p className="font-sans text-xs text-text-secondary">
        Country is the two-letter ISO code. Country and vehicle type are optional.
      </p>

      <div className="flex items-start gap-2">
        <Checkbox
          id={`wmi-sighted-${wmi}`}
          checked={sighted}
          onCheckedChange={(checked) => setSighted(checked === true)}
          disabled={pending}
          className="mt-0.5"
        />
        <Label
          htmlFor={`wmi-sighted-${wmi}`}
          className="font-normal leading-snug text-text-secondary"
        >
          I have sighted a document for this WMI (CoC, registration, or type approval)
        </Label>
      </div>

      {formError && (
        <p role="alert" className="font-sans text-sm text-status-error">
          {formError}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="secondary" disabled={!canSubmit}>
          {pending ? (
            <SpinnerIcon size={16} className="animate-spin" />
          ) : (
            "Sign and publish"
          )}
        </Button>
        <Button type="button" variant="ghost" disabled={pending} onClick={onClose}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

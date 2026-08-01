"use client";

import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  COMPENSATION_FORM,
  type CompensationForm,
} from "@/lib/commerce/denomination";
import {
  COMPENSATION_FORM_DEFS,
  compensationFormDef,
} from "@/lib/commerce/compensation-form";
import { cn } from "@/lib/utils";

type Props = {
  form: CompensationForm;
  onFormChange: (form: CompensationForm) => void;
  commissionPercent: string;
  onCommissionPercentChange: (value: string) => void;
  disabled?: boolean;
  /** Optional tip under the selector (e.g. ascending natural pairing). */
  tip?: string;
};

/**
 * Compensation form choice + consequence from form definitions.
 * Dialogs must not invent money-consequence copy.
 */
export function MandateCompensationFields({
  form,
  onFormChange,
  commissionPercent,
  onCommissionPercentChange,
  disabled = false,
  tip,
}: Props) {
  const def = compensationFormDef(form);

  return (
    <div className="space-y-3">
      <p className="font-mono text-[10.5px] font-medium uppercase tracking-[0.14em] text-text-tertiary">
        Compensation
      </p>
      <div className="flex gap-2">
        {COMPENSATION_FORM_DEFS.map((option) => (
          <button
            key={option.form}
            type="button"
            disabled={disabled}
            onClick={() => onFormChange(option.form)}
            className={cn(
              "min-h-11 flex-1 rounded-sm border px-3 font-sans text-sm font-medium transition-colors",
              "focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]",
              form === option.form
                ? "border-border-hover bg-bg-primary text-text-primary"
                : "border-border-default text-text-secondary hover:border-border-hover",
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
      <p className="font-sans text-sm text-text-secondary">{def.consequence}</p>
      {tip ? (
        <p className="font-sans text-xs text-text-tertiary">{tip}</p>
      ) : null}
      {form === COMPENSATION_FORM.Commission ? (
        <div className="space-y-2">
          <Label htmlFor="mandate-commission-pct">Commission rate (%)</Label>
          <Input
            id="mandate-commission-pct"
            inputMode="decimal"
            placeholder="5"
            value={commissionPercent}
            onChange={(e) => onCommissionPercentChange(e.target.value)}
            disabled={disabled}
            className="border-border-default bg-bg-card"
          />
        </div>
      ) : null}
    </div>
  );
}

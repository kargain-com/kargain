"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { parseLud16 } from "@/lib/lightning/lud16";

type LightningAddressFieldProps = {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  touched?: boolean;
  invalid?: boolean;
  disabled?: boolean;
  helperText?: string;
};

export function LightningAddressField({
  id = "lightning-address",
  value,
  onChange,
  onBlur,
  touched = false,
  invalid,
  disabled = false,
  helperText = "Required for Lightning payments. Format: name@domain.",
}: LightningAddressFieldProps) {
  const lud16Invalid =
    invalid ?? (value.trim().length > 0 && parseLud16(value.trim()) == null);

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>Lightning address</Label>
      <Input
        id={id}
        type="text"
        value={value}
        placeholder="name@domain"
        className="font-mono text-sm"
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
      />
      <p className="font-sans text-sm text-text-secondary">{helperText}</p>
      {touched && lud16Invalid && (
        <p className="font-sans text-sm text-status-error" role="alert">
          Enter a valid Lightning address (name@domain).
        </p>
      )}
    </div>
  );
}

export function isLightningAddressInvalid(value: string): boolean {
  return value.trim().length > 0 && parseLud16(value.trim()) == null;
}

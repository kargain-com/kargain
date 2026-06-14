"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type EvidenceInputLabels = {
  evidenceLabel: string;
  evidenceHint: string;
  evidencePlaceholder: string;
  evidenceFileLabel: string;
};

type Props = {
  value: string;
  onChange: (value: string) => void;
  file: File | null;
  onFileChange: (file: File | null) => void;
  labels: EvidenceInputLabels;
  disabled?: boolean;
  idPrefix?: string;
};

export function EvidenceInput({
  value,
  onChange,
  file,
  onFileChange,
  labels,
  disabled = false,
  idPrefix = "evidence",
}: Props) {
  const pasteId = `${idPrefix}-paste`;
  const fileId = `${idPrefix}-file`;

  return (
    <div className="space-y-2">
      <Label htmlFor={pasteId}>{labels.evidenceLabel}</Label>
      <p className="text-xs text-text-secondary">{labels.evidenceHint}</p>
      <Input
        id={pasteId}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={labels.evidencePlaceholder}
        disabled={disabled || Boolean(file)}
      />
      <div className="space-y-1">
        <Label htmlFor={fileId} className="text-xs text-text-secondary">
          {labels.evidenceFileLabel}
        </Label>
        <Input
          id={fileId}
          type="file"
          accept="image/*,.pdf,application/pdf"
          disabled={disabled}
          onChange={(e) => {
            const next = e.target.files?.[0] ?? null;
            onFileChange(next);
            if (next) onChange("");
          }}
        />
        {file && (
          <p className="font-sans text-xs text-text-secondary">
            {file.name}
            {" · "}
            <button
              type="button"
              className="text-accent-warm hover:underline"
              disabled={disabled}
              onClick={() => {
                onFileChange(null);
              }}
            >
              Clear
            </button>
          </p>
        )}
      </div>
    </div>
  );
}

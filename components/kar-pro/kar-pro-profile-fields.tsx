"use client";

import { ChevronDown } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { KAR_PRO_CATEGORY_OPTIONS } from "@/lib/kar-pro/kar-pro-metadata";

export type KarProProfileFieldValues = {
  categoryIndex: number;
  name: string;
  description: string;
  website: string;
};

type KarProProfileFieldsProps = {
  idPrefix?: string;
  values: KarProProfileFieldValues;
  onChange: (values: KarProProfileFieldValues) => void;
  disabled?: boolean;
};

export function KarProProfileFields({
  idPrefix = "kar-pro",
  values,
  onChange,
  disabled = false,
}: KarProProfileFieldsProps) {
  const categoryId = `${idPrefix}-category`;
  const nameId = `${idPrefix}-name`;
  const descriptionId = `${idPrefix}-description`;
  const websiteId = `${idPrefix}-website`;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={categoryId} className="font-sans text-fluid-sm text-text-secondary">
          Category
        </Label>
        <div className="relative">
          <select
            id={categoryId}
            name="category"
            value={String(values.categoryIndex)}
            disabled={disabled}
            onChange={(e) =>
              onChange({ ...values, categoryIndex: Number.parseInt(e.target.value, 10) })
            }
            className="w-full min-h-11 appearance-none px-4 py-3 pr-10 rounded-sm border border-border-default bg-bg-card text-text-primary font-sans text-base transition-colors duration-200 focus:outline-none focus:border-accent-warm focus:bg-bg-surface focus-visible:shadow-[var(--focus-ring)] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {KAR_PRO_CATEGORY_OPTIONS.map((option) => (
              <option key={option.index} value={String(option.index)}>
                {option.label}
              </option>
            ))}
          </select>
          <ChevronDown
            size={20}
            strokeWidth={1.5}
            className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-text-tertiary"
            aria-hidden
          />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={nameId} className="font-sans text-fluid-sm text-text-secondary">
          Display name
        </Label>
        <Input
          id={nameId}
          name="name"
          type="text"
          required
          disabled={disabled}
          value={values.name}
          onChange={(e) => onChange({ ...values, name: e.target.value })}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={descriptionId} className="font-sans text-fluid-sm text-text-secondary">
          Description
        </Label>
        <Textarea
          id={descriptionId}
          name="description"
          rows={4}
          maxLength={500}
          disabled={disabled}
          value={values.description}
          onChange={(e) => onChange({ ...values, description: e.target.value })}
          placeholder="Optional — describe your verification services"
        />
        <p className="font-sans text-fluid-sm text-text-secondary">
          {values.description.length}/500 characters
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={websiteId} className="font-sans text-fluid-sm text-text-secondary">
          Website
        </Label>
        <Input
          id={websiteId}
          name="website"
          type="url"
          disabled={disabled}
          value={values.website}
          onChange={(e) => onChange({ ...values, website: e.target.value })}
          placeholder="https://"
        />
      </div>
    </div>
  );
}

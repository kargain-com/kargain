"use client";

import { CheckCircle, ChevronDown, Loader2, XCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { checkSlugAvailability } from "@/app/actions/kar-pro-slug";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  KAR_PRO_CATEGORY_OPTIONS,
  SLUG_PATTERN,
  slugify,
} from "@/lib/kar-pro/kar-pro-metadata";

export type KarProProfileFieldValues = {
  categoryIndex: number;
  name: string;
  slug: string;
  description: string;
  website: string;
};

export type SlugAvailabilityStatus =
  | "idle"
  | "checking"
  | "available"
  | "taken"
  | "invalid_format";

type KarProProfileFieldsProps = {
  idPrefix?: string;
  values: KarProProfileFieldValues;
  onChange: (values: KarProProfileFieldValues) => void;
  disabled?: boolean;
  ownerAddress?: string;
  onSlugAvailabilityChange?: (status: SlugAvailabilityStatus) => void;
};

export function KarProProfileFields({
  idPrefix = "kar-pro",
  values,
  onChange,
  disabled = false,
  ownerAddress,
  onSlugAvailabilityChange,
}: KarProProfileFieldsProps) {
  const categoryId = `${idPrefix}-category`;
  const nameId = `${idPrefix}-name`;
  const slugId = `${idPrefix}-slug`;
  const descriptionId = `${idPrefix}-description`;
  const websiteId = `${idPrefix}-website`;

  const [asyncResult, setAsyncResult] = useState<{
    slug: string;
    status: "available" | "taken" | "idle" | "invalid_format";
  } | null>(null);
  const lastAutoSuggestion = useRef("");
  const slugDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const trimmedSlug = values.slug.trim();
  const syncSlugStatus: SlugAvailabilityStatus = !trimmedSlug
    ? "idle"
    : !SLUG_PATTERN.test(trimmedSlug)
      ? "invalid_format"
      : "checking";

  const slugStatus: SlugAvailabilityStatus =
    syncSlugStatus !== "checking"
      ? syncSlugStatus
      : asyncResult?.slug === trimmedSlug
        ? asyncResult.status
        : "checking";

  useEffect(() => {
    onSlugAvailabilityChange?.(slugStatus);
  }, [slugStatus, onSlugAvailabilityChange]);

  useEffect(() => {
    if (syncSlugStatus !== "checking") return;

    if (slugDebounceRef.current) clearTimeout(slugDebounceRef.current);

    const slug = trimmedSlug;
    slugDebounceRef.current = setTimeout(() => {
      void checkSlugAvailability(slug, ownerAddress).then((result) => {
        if (!result.available) {
          if (result.reason === "invalid_format" || result.reason === "invalid_length") {
            setAsyncResult({ slug, status: "invalid_format" });
          } else if (result.reason === "error") {
            setAsyncResult({ slug, status: "idle" });
          } else {
            setAsyncResult({ slug, status: "taken" });
          }
        } else {
          setAsyncResult({ slug, status: "available" });
        }
      });
    }, 500);

    return () => {
      if (slugDebounceRef.current) clearTimeout(slugDebounceRef.current);
    };
  }, [trimmedSlug, ownerAddress, syncSlugStatus]);

  const handleNameChange = (name: string) => {
    const prevSuggestion = lastAutoSuggestion.current;
    const shouldAutoSlug =
      !values.slug.trim() ||
      values.slug === prevSuggestion ||
      values.slug === slugify(values.name);

    let nextSlug = values.slug;
    if (shouldAutoSlug) {
      nextSlug = slugify(name);
      lastAutoSuggestion.current = nextSlug;
    }

    onChange({ ...values, name, slug: nextSlug });
  };

  const slugIndicator = (() => {
    if (slugStatus === "checking") {
      return (
        <span className="inline-flex items-center gap-1.5 font-mono text-xs text-text-secondary">
          <Loader2 size={14} strokeWidth={1.5} className="animate-spin" aria-hidden />
          Checking…
        </span>
      );
    }
    if (slugStatus === "available") {
      return (
        <span className="inline-flex items-center gap-1.5 font-mono text-xs text-text-secondary">
          <CheckCircle size={14} strokeWidth={1.5} aria-hidden />
          Available
        </span>
      );
    }
    if (slugStatus === "taken") {
      return (
        <span className="inline-flex items-center gap-1.5 font-mono text-xs text-status-error">
          <XCircle size={14} strokeWidth={1.5} aria-hidden />
          Already taken
        </span>
      );
    }
    if (slugStatus === "invalid_format") {
      return (
        <span className="inline-flex items-center gap-1.5 font-mono text-xs text-status-error">
          <XCircle size={14} strokeWidth={1.5} aria-hidden />
          Letters, numbers, hyphens only
        </span>
      );
    }
    return null;
  })();

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
          onChange={(e) => handleNameChange(e.target.value)}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={slugId} className="font-sans text-fluid-sm text-text-secondary">
          Pro URL
        </Label>
        <div className="flex flex-col gap-1.5">
          <div className="inline-flex items-center gap-0 w-full">
            <span className="font-mono text-sm text-text-tertiary bg-bg-surface border border-r-0 border-border-default rounded-l-sm px-3 min-h-11 flex items-center shrink-0">
              kargain.com/pro/
            </span>
            <Input
              id={slugId}
              name="slug"
              type="text"
              required
              disabled={disabled}
              value={values.slug}
              onChange={(e) => onChange({ ...values, slug: e.target.value.toLowerCase() })}
              className="rounded-l-none border-border-default"
              aria-invalid={slugStatus === "invalid_format" || slugStatus === "taken"}
            />
          </div>
          {slugIndicator}
        </div>
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

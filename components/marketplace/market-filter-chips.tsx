"use client";

import { X } from "lucide-react";

import { useMarketFilterNavigation } from "@/hooks/use-market-filters";
import { useDisplayCurrency } from "@/lib/marketplace/display-currency-context";
import {
  clearFilterChip,
  countActiveFilters,
  getFilterChips,
  type FilterChipKey,
} from "@/lib/marketplace/filter-params";

export function MarketFilterChips() {
  const { filters, pushFilters, clearAll } = useMarketFilterNavigation();
  const { displayCurrency } = useDisplayCurrency();
  const activeCount = countActiveFilters(filters);

  if (activeCount === 0) return null;

  const chips = getFilterChips(filters, displayCurrency);

  const removeChip = (key: FilterChipKey) => {
    pushFilters(clearFilterChip(filters, key));
  };

  return (
    <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-2 px-6 py-2 md:px-8 xl:max-w-[80rem]">
      {chips.map((chip) => (
        <span
          key={chip.key}
          className="inline-flex items-center gap-1 rounded-sm border border-border-default bg-bg-surface px-2 py-1 font-mono text-xs tracking-wide text-text-primary"
        >
          <button
            type="button"
            onClick={() => removeChip(chip.key)}
            className="text-text-secondary transition-colors hover:text-text-primary"
            aria-label={`Remove ${chip.label} filter`}
          >
            <X size={12} strokeWidth={2} aria-hidden />
          </button>
          {chip.label}
        </span>
      ))}
      <button
        type="button"
        onClick={clearAll}
        className="font-mono text-xs text-text-secondary transition-colors hover:text-text-primary"
      >
        Clear all
      </button>
    </div>
  );
}

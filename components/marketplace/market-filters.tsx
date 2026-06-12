"use client";

import { ChevronDown, SlidersHorizontal } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { useFacets } from "@/hooks/use-facets";
import {
  countActiveFilters,
  DEFAULT_MARKET_FILTERS,
  filtersFromSearchParams,
  filtersToSearchParams,
  type MarketFilterState,
  type MarketSort,
  type VerificationFilter,
} from "@/lib/marketplace/filter-params";
import { cn } from "@/lib/utils";

const FUEL_OPTIONS = ["Petrol", "Diesel", "Electric", "Hybrid", "Other"] as const;
const BODY_OPTIONS = ["Sedan", "SUV", "Hatchback", "Coupe", "Van", "Truck", "Other"] as const;
const TRANSMISSION_OPTIONS = ["Manual", "Automatic"] as const;

const SORT_LABELS: Record<MarketSort, string> = {
  newest: "Newest",
  price_asc: "Price: low to high",
  price_desc: "Price: high to low",
  mileage_asc: "Mileage",
};

type ComboboxProps = {
  id: string;
  label: string;
  value: string;
  options: string[];
  disabled?: boolean;
  placeholder?: string;
  onChange: (value: string) => void;
};

function FilterCombobox({
  id,
  label,
  value,
  options,
  disabled,
  placeholder,
  onChange,
}: ComboboxProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(value);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setQuery(value);
  }, [value]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.toLowerCase().includes(q));
  }, [options, query]);

  return (
    <div ref={wrapRef} className="relative space-y-1.5">
      <Label htmlFor={id} className="font-sans text-sm text-text-secondary">
        {label}
      </Label>
      <input
        id={id}
        type="text"
        disabled={disabled}
        value={query}
        placeholder={placeholder}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          if (!e.target.value) onChange("");
        }}
        onFocus={() => setOpen(true)}
        className="w-full rounded-sm border border-border-default bg-bg-primary px-3 py-2 font-sans text-sm text-text-primary transition-colors focus:border-accent-warm focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
      />
      {open && !disabled && filtered.length > 0 && (
        <ul
          className="absolute z-20 mt-1 max-h-48 w-full overflow-auto rounded-sm border border-border-default bg-bg-card py-1 shadow-none"
          role="listbox"
        >
          {filtered.map((opt) => (
            <li key={opt}>
              <button
                type="button"
                role="option"
                aria-selected={opt === value}
                className="w-full px-3 py-2 text-left font-sans text-sm text-text-primary transition-colors hover:bg-bg-surface"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onChange(opt);
                  setQuery(opt);
                  setOpen(false);
                }}
              >
                {opt}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function FilterSection({
  title,
  defaultOpen = true,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Collapsible defaultOpen={defaultOpen} className="border-b border-border-default py-3">
      <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 font-sans text-sm font-medium text-text-primary">
        {title}
        <ChevronDown className="h-4 w-4 text-text-secondary" />
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-3 pt-3">{children}</CollapsibleContent>
    </Collapsible>
  );
}

function StatusRadio({
  value,
  status,
  label,
  onChange,
}: {
  value: VerificationFilter;
  status: VerificationFilter;
  label: string;
  onChange: (v: VerificationFilter) => void;
}) {
  const selected = value === status;
  return (
    <label className="flex cursor-pointer items-center gap-2">
      <button
        type="button"
        role="radio"
        aria-checked={selected}
        onClick={() => onChange(status)}
        className={cn(
          "flex h-4 w-4 items-center justify-center rounded-full border border-border-default",
          selected && "border-accent-warm",
        )}
      >
        {selected && <span className="h-2 w-2 rounded-full bg-accent-warm" />}
      </button>
      <span className="font-sans text-sm text-text-secondary">{label}</span>
    </label>
  );
}

function CheckboxRow({
  id,
  label,
  checked,
  onCheckedChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <label htmlFor={id} className="flex cursor-pointer items-center gap-2">
      <Checkbox id={id} checked={checked} onCheckedChange={(v) => onCheckedChange(v === true)} />
      <span className="font-sans text-sm text-text-secondary">{label}</span>
    </label>
  );
}

type FilterPanelProps = {
  filters: MarketFilterState;
  onPatch: (patch: Partial<MarketFilterState>) => void;
  facets: ReturnType<typeof useFacets>["facets"];
};

function FilterPanel({ filters, onPatch, facets }: FilterPanelProps) {
  const makeOptions = facets?.makes ?? [];
  const modelOptions = filters.make ? (facets?.models[filters.make] ?? []) : [];

  const toggleInList = (list: string[], item: string): string[] =>
    list.includes(item) ? list.filter((x) => x !== item) : [...list, item];

  return (
    <div className="space-y-0">
      <FilterSection title="Make & model">
        <FilterCombobox
          id="filter-make"
          label="Make"
          value={filters.make}
          options={makeOptions}
          placeholder="Select make"
          onChange={(make) => onPatch({ make, model: "", page: 1 })}
        />
        <FilterCombobox
          id="filter-model"
          label="Model"
          value={filters.model}
          options={modelOptions}
          disabled={!filters.make}
          placeholder={filters.make ? "Select model" : "Select make first"}
          onChange={(model) => onPatch({ model, page: 1 })}
        />
      </FilterSection>

      <FilterSection title="Year">
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1.5">
            <Label htmlFor="year-min" className="font-sans text-sm text-text-secondary">
              From
            </Label>
            <input
              id="year-min"
              type="number"
              min={0}
              placeholder={facets ? String(facets.yearMin || "") : ""}
              value={filters.yearMin}
              onChange={(e) => onPatch({ yearMin: e.target.value, page: 1 })}
              className="min-w-0 h-9 w-full rounded-sm border border-border-default bg-bg-primary px-3 font-mono text-sm text-text-primary focus:border-accent-warm focus:outline-none"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="year-max" className="font-sans text-sm text-text-secondary">
              To
            </Label>
            <input
              id="year-max"
              type="number"
              min={0}
              placeholder={facets ? String(facets.yearMax || "") : ""}
              value={filters.yearMax}
              onChange={(e) => onPatch({ yearMax: e.target.value, page: 1 })}
              className="min-w-0 h-9 w-full rounded-sm border border-border-default bg-bg-primary px-3 font-mono text-sm text-text-primary focus:border-accent-warm focus:outline-none"
            />
          </div>
        </div>
      </FilterSection>

      <FilterSection title="Price">
        <div className="flex gap-1">
          {(["USD", "EUR"] as const).map((cur) => (
            <button
              key={cur}
              type="button"
              onClick={() => onPatch({ currency: cur, page: 1 })}
              className={cn(
                "rounded-sm border px-2 py-1 font-mono text-xs transition-colors",
                filters.currency === cur
                  ? "border-accent-warm text-accent-warm"
                  : "border-border-default text-text-secondary hover:text-text-primary",
              )}
            >
              {cur}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1.5">
            <Label htmlFor="price-min" className="font-sans text-sm text-text-secondary">
              Min
            </Label>
            <input
              id="price-min"
              type="number"
              min={0}
              placeholder={facets ? String(facets.priceMin || "") : ""}
              value={filters.priceMin}
              onChange={(e) => onPatch({ priceMin: e.target.value, page: 1 })}
              className="min-w-0 h-9 w-full rounded-sm border border-border-default bg-bg-primary px-3 font-mono text-sm text-text-primary focus:border-accent-warm focus:outline-none"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="price-max" className="font-sans text-sm text-text-secondary">
              Max
            </Label>
            <input
              id="price-max"
              type="number"
              min={0}
              placeholder={facets ? String(facets.priceMax || "") : ""}
              value={filters.priceMax}
              onChange={(e) => onPatch({ priceMax: e.target.value, page: 1 })}
              className="min-w-0 h-9 w-full rounded-sm border border-border-default bg-bg-primary px-3 font-mono text-sm text-text-primary focus:border-accent-warm focus:outline-none"
            />
          </div>
        </div>
      </FilterSection>

      <FilterSection title="Mileage">
        <div className="space-y-1.5">
          <Label htmlFor="mileage-max" className="font-sans text-sm text-text-secondary">
            Up to
          </Label>
          <div className="flex items-center gap-2">
            <input
              id="mileage-max"
              type="number"
              min={0}
              placeholder={facets ? String(facets.mileageMax || "") : ""}
              value={filters.mileageMax}
              onChange={(e) => onPatch({ mileageMax: e.target.value, page: 1 })}
              className="min-w-0 h-9 w-full flex-1 rounded-sm border border-border-default bg-bg-primary px-3 font-mono text-sm text-text-primary focus:border-accent-warm focus:outline-none"
            />
            <span className="shrink-0 font-mono text-xs text-text-secondary">km</span>
          </div>
        </div>
      </FilterSection>

      <FilterSection title="Verification">
        <div className="space-y-2">
          <StatusRadio
            value={filters.status}
            status="all"
            label="All"
            onChange={(status) => onPatch({ status, page: 1 })}
          />
          <StatusRadio
            value={filters.status}
            status="VERIFIED"
            label="Verified only"
            onChange={(status) => onPatch({ status, page: 1 })}
          />
          <StatusRadio
            value={filters.status}
            status="UNVERIFIED"
            label="Unverified only"
            onChange={(status) => onPatch({ status, page: 1 })}
          />
        </div>
      </FilterSection>

      <FilterSection title="Fuel">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {FUEL_OPTIONS.map((opt) => (
            <CheckboxRow
              key={opt}
              id={`fuel-${opt}`}
              label={opt}
              checked={filters.fuelTypes.includes(opt)}
              onCheckedChange={() =>
                onPatch({ fuelTypes: toggleInList(filters.fuelTypes, opt), page: 1 })
              }
            />
          ))}
        </div>
      </FilterSection>

      <FilterSection title="Body type">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {BODY_OPTIONS.map((opt) => (
            <CheckboxRow
              key={opt}
              id={`body-${opt}`}
              label={opt}
              checked={filters.bodyTypes.includes(opt)}
              onCheckedChange={() =>
                onPatch({ bodyTypes: toggleInList(filters.bodyTypes, opt), page: 1 })
              }
            />
          ))}
        </div>
      </FilterSection>

      <FilterSection title="Transmission">
        <div className="space-y-2">
          {TRANSMISSION_OPTIONS.map((opt) => (
            <CheckboxRow
              key={opt}
              id={`trans-${opt}`}
              label={opt}
              checked={filters.transmissions.includes(opt)}
              onCheckedChange={() =>
                onPatch({ transmissions: toggleInList(filters.transmissions, opt), page: 1 })
              }
            />
          ))}
        </div>
      </FilterSection>
    </div>
  );
}

export function MarketSortSelect({
  sort,
  onSortChange,
  className,
}: {
  sort: MarketSort;
  onSortChange: (sort: MarketSort) => void;
  className?: string;
}) {
  return (
    <Select value={sort} onValueChange={(v) => onSortChange(v as MarketSort)}>
      <SelectTrigger
        className={cn(
          "h-9 rounded-sm border border-border-default px-3 font-sans text-sm text-text-secondary",
          className,
        )}
        aria-label="Sort listings"
      >
        <SelectValue placeholder="Sort" />
      </SelectTrigger>
      <SelectContent>
        {(Object.keys(SORT_LABELS) as MarketSort[]).map((key) => (
          <SelectItem key={key} value={key}>
            {SORT_LABELS[key]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function useMarketFilterNavigation() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const filters = useMemo(() => filtersFromSearchParams(searchParams), [searchParams]);

  const pushFilters = useCallback(
    (next: MarketFilterState) => {
      const sp = filtersToSearchParams(next);
      const qs = sp.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router],
  );

  const patchFilters = useCallback(
    (patch: Partial<MarketFilterState>) => {
      pushFilters({ ...filters, ...patch });
    },
    [filters, pushFilters],
  );

  const clearAll = useCallback(() => {
    pushFilters({ ...DEFAULT_MARKET_FILTERS });
  }, [pushFilters]);

  return { filters, pushFilters, patchFilters, clearAll };
}

export function MarketFiltersSidebar() {
  const { facets, isLoading } = useFacets();
  const { filters, patchFilters, clearAll } = useMarketFilterNavigation();
  const activeCount = countActiveFilters(filters);

  return (
    <aside className="hidden w-[260px] shrink-0 lg:block" aria-label="Filters">
      <div className="sticky top-24 max-h-[calc(100dvh-7rem)] overflow-y-auto rounded-md border border-border-default bg-bg-card p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-accent-warm">Filters</p>
          {activeCount > 0 && (
            <button
              type="button"
              onClick={clearAll}
              className="cursor-pointer font-sans text-xs text-text-secondary transition-colors hover:text-text-primary"
            >
              Clear all
            </button>
          )}
        </div>
        {isLoading && !facets ? (
          <p className="font-sans text-sm text-text-secondary">Loading filters…</p>
        ) : (
          <FilterPanel filters={filters} onPatch={patchFilters} facets={facets} />
        )}
      </div>
    </aside>
  );
}

export function MarketFiltersMobile() {
  const { facets } = useFacets();
  const { filters, pushFilters, clearAll } = useMarketFilterNavigation();
  const activeCount = countActiveFilters(filters);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [draft, setDraft] = useState<MarketFilterState>(filters);

  useEffect(() => {
    if (sheetOpen) setDraft(filters);
  }, [sheetOpen, filters]);

  return (
    <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
      <SheetTrigger asChild>
        <Button type="button" variant="secondary" size="sm" className="gap-2 lg:hidden">
          <SlidersHorizontal className="h-4 w-4" aria-hidden />
          Filters
          {activeCount > 0 && (
            <span className="font-mono text-xs text-accent-warm">· {activeCount}</span>
          )}
        </Button>
      </SheetTrigger>
      <SheetContent side="bottom" className="p-0">
        <SheetHeader>
          <SheetTitle>Filters</SheetTitle>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto px-4 pb-4">
          <FilterPanel
            filters={draft}
            onPatch={(patch) => setDraft((prev) => ({ ...prev, ...patch }))}
            facets={facets}
          />
        </div>
        <SheetFooter>
          <Button
            type="button"
            variant="ghost"
            className="flex-1"
            onClick={() => setDraft({ ...DEFAULT_MARKET_FILTERS })}
          >
            Clear all
          </Button>
          <Button
            type="button"
            variant="primary"
            className="flex-1"
            onClick={() => {
              pushFilters(draft);
              setSheetOpen(false);
            }}
          >
            Apply filters
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

export function useMarketFiltersFromUrl() {
  const searchParams = useSearchParams();
  return useMemo(() => filtersFromSearchParams(searchParams), [searchParams]);
}

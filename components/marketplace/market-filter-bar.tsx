"use client";

import { ChevronDown, Filter, Search, SlidersHorizontal } from "lucide-react";
import { useEffect, useState } from "react";

import { FilterCombobox } from "@/components/marketplace/filter-combobox";
import { FILTER_TRIGGER_BASE } from "@/components/marketplace/filter-constants";
import { MarketFilterDrawer } from "@/components/marketplace/market-filter-drawer";
import { MarketSortSelect } from "@/components/marketplace/market-sort-select";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useFacets } from "@/hooks/use-facets";
import { useMarketRatesRequest } from "@/hooks/use-market-rates-request";
import { useMarketFilterNavigation } from "@/hooks/use-market-filters";
import { shouldFetchListingFacets } from "@/lib/marketplace/listing-facets-fetch";
import { isCryptoDisplayCurrency } from "@/lib/marketplace/currency-code";
import { useDisplayCurrency } from "@/lib/marketplace/display-currency-context";
import { CRYPTO_DISPLAY_CONFIG } from "@/lib/marketplace/fx-rate-registry";
import { pickPartialFxRates } from "@/lib/marketplace/fx-rate-registry";
import {
  countActiveFilters,
  countDrawerActiveFilters,
  formatMultiValueChipLabel,
  formatPriceChipLabel,
  priceFilterPlaceholder,
  type VerificationFilter,
} from "@/lib/marketplace/filter-params";
import {
  rateRequiredForPriceCurrency,
  ratesReadyForPriceCurrency,
  usdFacetRangeToCrypto,
} from "@/lib/marketplace/price-normalize";
import { STATUS_FILTER_OPTIONS } from "@/components/marketplace/filter-constants";
import { cn } from "@/lib/utils";

function FilterTrigger({
  active,
  children,
  className,
  ...props
}: React.ComponentProps<"button"> & { active?: boolean }) {
  return (
    <button
      type="button"
      className={cn(
        FILTER_TRIGGER_BASE,
        active && "border-accent-warm text-accent-warm",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}

function FilterSearchInput({
  value,
  onChange,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  return (
    <div className={cn("relative", className)}>
      <Search
        className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-text-tertiary"
        size={16}
        strokeWidth={1.5}
        aria-hidden
      />
      <input
        id="market-filter-search"
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search make, model, VIN…"
        aria-label="Search make, model, VIN"
        className="min-h-11 w-full rounded-sm border border-border-default bg-bg-card px-4 py-3 pl-11 pr-4 font-sans text-base text-text-primary placeholder:text-text-tertiary transition-colors duration-200 focus:border-accent-warm focus:outline-none focus-visible:shadow-[var(--focus-ring)]"
      />
    </div>
  );
}

export function MarketFilterBar() {
  const { filters, patchFilters } = useMarketFilterNavigation();
  const fxContext = useDisplayCurrency();
  const filterRates = pickPartialFxRates(fxContext);
  const { displayCurrency, isRatesLoading } = fxContext;
  const [searchInput, setSearchInput] = useState(filters.search);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [priceOpen, setPriceOpen] = useState(false);
  const [makeOpen, setMakeOpen] = useState(false);
  const [fuelOpen, setFuelOpen] = useState(false);
  const [priceDraft, setPriceDraft] = useState({
    priceMin: filters.priceMin,
    priceMax: filters.priceMax,
  });

  const [prevFilterSearch, setPrevFilterSearch] = useState(filters.search);
  if (filters.search !== prevFilterSearch) {
    setPrevFilterSearch(filters.search);
    setSearchInput(filters.search);
  }

  const [prevPriceMin, setPrevPriceMin] = useState(filters.priceMin);
  const [prevPriceMax, setPrevPriceMax] = useState(filters.priceMax);
  if (
    priceOpen &&
    (filters.priceMin !== prevPriceMin || filters.priceMax !== prevPriceMax)
  ) {
    setPrevPriceMin(filters.priceMin);
    setPrevPriceMax(filters.priceMax);
    setPriceDraft({ priceMin: filters.priceMin, priceMax: filters.priceMax });
  }

  const handlePriceOpenChange = (open: boolean) => {
    if (open) {
      setPriceDraft({ priceMin: filters.priceMin, priceMax: filters.priceMax });
      setPrevPriceMin(filters.priceMin);
      setPrevPriceMax(filters.priceMax);
    }
    setPriceOpen(open);
  };

  const facetsEnabled = shouldFetchListingFacets({
    priceOpen,
    makeOpen,
    fuelOpen,
    drawerOpen,
  });
  const { facets } = useFacets({ enabled: facetsEnabled });

  useMarketRatesRequest(priceOpen && rateRequiredForPriceCurrency(displayCurrency));

  const debouncedSearch = useDebouncedValue(searchInput, 300);

  useEffect(() => {
    if (debouncedSearch !== filters.search) {
      patchFilters({ search: debouncedSearch, page: 1 });
    }
  }, [debouncedSearch, filters.search, patchFilters]);

  const activeCount = countActiveFilters(filters);
  const drawerCount = countDrawerActiveFilters(filters);
  const makeOptions = facets?.makes ?? [];
  const fuelOptions = facets?.fuelTypes ?? [];

  const statusLabel =
    STATUS_FILTER_OPTIONS.find((o) => o.value === filters.status)?.label ?? "Status";
  const statusActive = filters.status !== "all";

  const priceActive = Boolean(filters.priceMin || filters.priceMax);
  const priceChipCurrency = filters.priceCurrency || displayCurrency;
  const priceLabel = priceActive
    ? formatPriceChipLabel(filters.priceMin, filters.priceMax, priceChipCurrency)
    : "Price";

  const makeActive = Boolean(filters.make);
  const fuelActive = filters.fuelTypes.length > 0;
  const fuelLabel = fuelActive
    ? filters.fuelTypes.length <= 2
      ? formatMultiValueChipLabel(filters.fuelTypes)
      : `${filters.fuelTypes.slice(0, 2).join(", ")} (+${filters.fuelTypes.length - 2})`
    : "Fuel";

  const fiatPriceRange =
    displayCurrency === "EUR"
      ? (facets?.priceRanges?.EUR ??
        ({ min: facets?.priceMin ?? 0, max: facets?.priceMax ?? 0 } as const))
      : (facets?.priceRanges?.USD ??
        ({ min: facets?.priceMin ?? 0, max: facets?.priceMax ?? 0 } as const));

  const usdRangeForCrypto =
    facets?.priceRanges?.USD ??
    ({ min: facets?.priceMin ?? 0, max: facets?.priceMax ?? 0 } as const);

  let priceRange = fiatPriceRange;
  if (isCryptoDisplayCurrency(displayCurrency)) {
    const config = CRYPTO_DISPLAY_CONFIG[displayCurrency];
    const cryptoRate = filterRates[config.rateField];
    if (cryptoRate != null) {
      priceRange = usdFacetRangeToCrypto(
        usdRangeForCrypto.min,
        usdRangeForCrypto.max,
        cryptoRate,
        config.scale,
      );
    }
  }

  const pricePlaceholder = priceFilterPlaceholder(displayCurrency);
  const priceDraftHasBounds = Boolean(priceDraft.priceMin || priceDraft.priceMax);
  const priceApplyNeedsRates =
    priceDraftHasBounds && rateRequiredForPriceCurrency(displayCurrency);
  const priceApplyDisabled =
    priceApplyNeedsRates &&
    (isRatesLoading || !ratesReadyForPriceCurrency(displayCurrency, filterRates));

  const toggleFuel = (opt: string) => {
    const next = filters.fuelTypes.includes(opt)
      ? filters.fuelTypes.filter((x) => x !== opt)
      : [...filters.fuelTypes, opt];
    patchFilters({ fuelTypes: next, page: 1 });
  };

  return (
    <>
      <div className="bg-bg-card border-b border-border-default py-3">
        {/* Mobile: two fixed rows */}
        <div className="md:hidden">
          <div className="flex w-full px-6 py-2">
            <FilterSearchInput
              value={searchInput}
              onChange={setSearchInput}
              className="w-full"
            />
          </div>
          <div className="flex w-full items-center gap-2 px-6 py-2">
            <FilterTrigger
              active={activeCount > 0}
              onClick={() => setDrawerOpen(true)}
              aria-label="Filters"
            >
              {activeCount === 0 && (
                <SlidersHorizontal size={16} strokeWidth={1.5} aria-hidden />
              )}
              {activeCount > 0 ? (
                <span>
                  Filters ·{" "}
                  <span className="font-mono text-xs tabular-nums">{activeCount}</span>
                </span>
              ) : (
                "Filters"
              )}
            </FilterTrigger>
            <div className="ml-auto">
              <MarketSortSelect
                sort={filters.sort}
                onSortChange={(sort) => patchFilters({ sort, page: 1 })}
                className="w-auto md:w-[180px]"
              />
            </div>
          </div>
        </div>

        {/* Desktop: single nowrap row */}
        <div className="mx-auto hidden w-full max-w-7xl flex-nowrap items-center gap-2 overflow-hidden px-6 md:flex md:px-8 xl:max-w-[80rem]">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <FilterSearchInput
              value={searchInput}
              onChange={setSearchInput}
              className="max-w-[240px] min-w-0 flex-1"
            />

            <Select
              value={filters.status}
              onValueChange={(v) =>
                patchFilters({ status: v as VerificationFilter, page: 1 })
              }
            >
              <SelectTrigger
                className={cn(
                  "min-h-11 w-auto shrink-0 gap-1.5 rounded-sm border border-border-default bg-transparent px-3 font-sans text-sm font-medium shadow-none",
                  statusActive
                    ? "border-accent-warm text-accent-warm"
                    : "text-text-primary",
                )}
                aria-label="Filter by status"
              >
                <SelectValue>{statusActive ? statusLabel : "Status"}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {STATUS_FILTER_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Popover open={priceOpen} onOpenChange={handlePriceOpenChange}>
              <PopoverTrigger asChild>
                <FilterTrigger active={priceActive} className="shrink-0">
                  {priceLabel}
                  <ChevronDown size={16} strokeWidth={1.5} aria-hidden />
                </FilterTrigger>
              </PopoverTrigger>
              <PopoverContent className="w-64 space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="bar-price-min" className="font-sans text-xs text-text-secondary">
                      Min
                    </Label>
                    <input
                      id="bar-price-min"
                      type="number"
                      min={0}
                      placeholder={facets ? String(priceRange.min || "") : pricePlaceholder}
                      value={priceDraft.priceMin}
                      onChange={(e) =>
                        setPriceDraft((d) => ({ ...d, priceMin: e.target.value }))
                      }
                      className="min-w-0 min-h-11 w-full rounded-sm border border-border-default bg-bg-card px-3 font-mono text-sm text-text-primary focus:border-accent-warm focus:outline-none"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="bar-price-max" className="font-sans text-xs text-text-secondary">
                      Max
                    </Label>
                    <input
                      id="bar-price-max"
                      type="number"
                      min={0}
                      placeholder={facets ? String(priceRange.max || "") : pricePlaceholder}
                      value={priceDraft.priceMax}
                      onChange={(e) =>
                        setPriceDraft((d) => ({ ...d, priceMax: e.target.value }))
                      }
                      className="min-w-0 min-h-11 w-full rounded-sm border border-border-default bg-bg-card px-3 font-mono text-sm text-text-primary focus:border-accent-warm focus:outline-none"
                    />
                  </div>
                </div>
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  className="w-full"
                  disabled={priceApplyDisabled}
                  title={priceApplyDisabled ? "Waiting for exchange rates…" : undefined}
                  onClick={() => {
                    const hasBounds = Boolean(priceDraft.priceMin || priceDraft.priceMax);
                    patchFilters({
                      priceMin: priceDraft.priceMin,
                      priceMax: priceDraft.priceMax,
                      priceCurrency: hasBounds ? displayCurrency : "",
                      page: 1,
                    });
                    setPriceOpen(false);
                  }}
                >
                  Apply
                </Button>
              </PopoverContent>
            </Popover>

            <Popover open={makeOpen} onOpenChange={setMakeOpen}>
              <PopoverTrigger asChild>
                <FilterTrigger active={makeActive} className="shrink-0">
                  {filters.make || "Make"}
                  <ChevronDown size={16} strokeWidth={1.5} aria-hidden />
                </FilterTrigger>
              </PopoverTrigger>
              <PopoverContent className="w-64">
                <FilterCombobox
                  id="bar-filter-make"
                  value={filters.make}
                  options={makeOptions}
                  placeholder="Search makes…"
                  onChange={(make) => {
                    patchFilters({ make, model: "", page: 1 });
                    setMakeOpen(false);
                  }}
                />
              </PopoverContent>
            </Popover>

            <Popover open={fuelOpen} onOpenChange={setFuelOpen}>
              <PopoverTrigger asChild>
                <FilterTrigger active={fuelActive} className="shrink-0">
                  {fuelLabel}
                  <ChevronDown size={16} strokeWidth={1.5} aria-hidden />
                </FilterTrigger>
              </PopoverTrigger>
              <PopoverContent className="max-h-64 w-56 space-y-2 overflow-y-auto">
                {fuelOptions.map((opt) => (
                  <label key={opt} htmlFor={`bar-fuel-${opt}`} className="flex cursor-pointer items-center gap-2">
                    <Checkbox
                      id={`bar-fuel-${opt}`}
                      checked={filters.fuelTypes.includes(opt)}
                      onCheckedChange={() => toggleFuel(opt)}
                    />
                    <span className="font-sans text-sm text-text-secondary">{opt}</span>
                  </label>
                ))}
              </PopoverContent>
            </Popover>

            <FilterTrigger
              active={drawerCount > 0}
              onClick={() => setDrawerOpen(true)}
              aria-label="More filters"
              className="shrink-0"
            >
              <Filter size={16} strokeWidth={1.5} aria-hidden />
              {drawerCount > 0 ? (
                <span>
                  Filters ·{" "}
                  <span className="font-mono text-xs tabular-nums">{drawerCount}</span>
                </span>
              ) : (
                "More filters"
              )}
            </FilterTrigger>
          </div>

          <div className="ml-auto flex shrink-0 items-center gap-2">
            <MarketSortSelect
              sort={filters.sort}
              onSortChange={(sort) => patchFilters({ sort, page: 1 })}
              className="w-auto md:w-[180px]"
            />
          </div>
        </div>
      </div>

      <MarketFilterDrawer open={drawerOpen} onOpenChange={setDrawerOpen} facets={facets} />
    </>
  );
}

"use client";

import { useEffect, useState } from "react";

import { FilterCombobox } from "@/components/marketplace/filter-combobox";
import { STATUS_FILTER_OPTIONS } from "@/components/marketplace/filter-constants";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useFacets } from "@/hooks/use-facets";
import { useMarketFilterNavigation } from "@/hooks/use-market-filters";
import { useDisplayCurrency } from "@/lib/marketplace/display-currency-context";
import {
  DEFAULT_MARKET_FILTERS,
  priceFilterPlaceholder,
  type MarketFilterState,
  type VerificationFilter,
} from "@/lib/marketplace/filter-params";
import { fiat1e8ToEthWei, FIAT_SCALE } from "@/lib/marketplace/price-normalize";
import {
  BODY_TYPE_OPTIONS,
  CONDITION_OPTIONS,
  TRANSMISSION_OPTIONS,
  VEHICLE_TYPE_OPTIONS,
} from "@/lib/passport/metadata-form-options";
import { cn } from "@/lib/utils";

function PillToggle({
  label,
  selected,
  onClick,
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-sm border px-3 py-1.5 font-sans text-sm transition-colors duration-200",
        selected
          ? "border-accent-warm bg-bg-surface text-accent-warm"
          : "border-border-default bg-transparent text-text-secondary hover:border-border-hover",
      )}
    >
      {label}
    </button>
  );
}

function DrawerSection({
  title,
  children,
  first,
}: {
  title: string;
  children: React.ReactNode;
  first?: boolean;
}) {
  return (
    <section
      className={cn(
        "space-y-3 py-4",
        first ? "border-b border-border-default" : "border-t border-border-default",
      )}
    >
      <h3 className="font-sans text-sm font-medium text-text-primary">{title}</h3>
      {children}
    </section>
  );
}

function toggleInList(list: string[], item: string): string[] {
  return list.includes(item) ? list.filter((x) => x !== item) : [...list, item];
}

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function MarketFilterDrawer({ open, onOpenChange }: Props) {
  const { facets } = useFacets();
  const { filters, pushFilters } = useMarketFilterNavigation();
  const { displayCurrency, ethUsd, eurUsd, isRatesLoading } = useDisplayCurrency();
  const [draft, setDraft] = useState<MarketFilterState>(filters);

  useEffect(() => {
    if (open) setDraft(filters);
  }, [open, filters]);

  const makeOptions = facets?.makes ?? [];
  const modelOptions = draft.make ? (facets?.models[draft.make] ?? []) : [];
  const fuelOptions = facets?.fuelTypes ?? [];
  const bodyOptions = facets?.bodyTypes?.length ? facets.bodyTypes : [...BODY_TYPE_OPTIONS];
  const transmissionOptions = facets?.transmissions?.length
    ? facets.transmissions
    : [...TRANSMISSION_OPTIONS];

  const patchDraft = (patch: Partial<MarketFilterState>) => {
    setDraft((prev) => ({ ...prev, ...patch }));
  };

  const mileageMaxPlaceholder = facets?.mileageMax
    ? facets.mileageMax.toLocaleString("en-US")
    : "";

  const fiatPriceRange =
    displayCurrency === "EUR"
      ? (facets?.priceRanges?.EUR ??
        ({ min: facets?.priceMin ?? 0, max: facets?.priceMax ?? 0 } as const))
      : (facets?.priceRanges?.USD ??
        ({ min: facets?.priceMin ?? 0, max: facets?.priceMax ?? 0 } as const));

  const usdRangeForEth =
    facets?.priceRanges?.USD ??
    ({ min: facets?.priceMin ?? 0, max: facets?.priceMax ?? 0 } as const);

  const priceRange =
    displayCurrency === "ETH" && ethUsd != null
      ? {
          min: usdRangeForEth.min
            ? fiat1e8ToEthWei(BigInt(Math.round(usdRangeForEth.min * Number(FIAT_SCALE))), ethUsd)
            : 0,
          max: usdRangeForEth.max
            ? fiat1e8ToEthWei(BigInt(Math.round(usdRangeForEth.max * Number(FIAT_SCALE))), ethUsd)
            : 0,
        }
      : fiatPriceRange;

  const pricePlaceholder = priceFilterPlaceholder(displayCurrency);
  const draftHasPriceBounds = Boolean(draft.priceMin || draft.priceMax);
  const showResultsNeedsRates = draftHasPriceBounds && displayCurrency !== "USD";
  const showResultsDisabled =
    showResultsNeedsRates && (isRatesLoading || ethUsd == null || eurUsd == null);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full max-w-sm flex-col p-0 sm:max-w-sm">
        <SheetHeader className="px-4 pt-4">
          <SheetTitle className="font-sans text-base font-medium">Filters</SheetTitle>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-4">
          <DrawerSection title="Status" first>
            <div className="flex flex-wrap gap-2">
              {STATUS_FILTER_OPTIONS.map((opt) => (
                <PillToggle
                  key={opt.value}
                  label={opt.label}
                  selected={draft.status === opt.value}
                  onClick={() => patchDraft({ status: opt.value as VerificationFilter })}
                />
              ))}
            </div>
          </DrawerSection>

          <DrawerSection title="Price">
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label htmlFor="drawer-price-min" className="font-sans text-xs text-text-secondary">
                  Min
                </Label>
                <input
                  id="drawer-price-min"
                  type="number"
                  min={0}
                  placeholder={facets ? String(priceRange.min || "") : pricePlaceholder}
                  value={draft.priceMin}
                  onChange={(e) => patchDraft({ priceMin: e.target.value })}
                  className="min-w-0 h-9 w-full rounded-sm border border-border-default bg-bg-card px-3 font-mono text-sm text-text-primary focus:border-accent-warm focus:outline-none"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="drawer-price-max" className="font-sans text-xs text-text-secondary">
                  Max
                </Label>
                <input
                  id="drawer-price-max"
                  type="number"
                  min={0}
                  placeholder={facets ? String(priceRange.max || "") : pricePlaceholder}
                  value={draft.priceMax}
                  onChange={(e) => patchDraft({ priceMax: e.target.value })}
                  className="min-w-0 h-9 w-full rounded-sm border border-border-default bg-bg-card px-3 font-mono text-sm text-text-primary focus:border-accent-warm focus:outline-none"
                />
              </div>
            </div>
          </DrawerSection>

          <DrawerSection title="Make">
            <FilterCombobox
              id="drawer-filter-make"
              value={draft.make}
              options={makeOptions}
              placeholder="Search makes…"
              onChange={(make) => patchDraft({ make, model: "" })}
            />
          </DrawerSection>

          {draft.make && (
            <DrawerSection title="Model">
              <FilterCombobox
                id="drawer-filter-model"
                value={draft.model}
                options={modelOptions}
                placeholder="All models"
                onChange={(model) => patchDraft({ model })}
              />
            </DrawerSection>
          )}

          <DrawerSection title="Fuel">
            <div className="flex flex-wrap gap-2">
              {fuelOptions.map((opt) => (
                <PillToggle
                  key={opt}
                  label={opt}
                  selected={draft.fuelTypes.includes(opt)}
                  onClick={() =>
                    patchDraft({ fuelTypes: toggleInList(draft.fuelTypes, opt) })
                  }
                />
              ))}
            </div>
          </DrawerSection>

          <DrawerSection title="Year">
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label htmlFor="drawer-year-min" className="font-sans text-xs text-text-secondary">
                  From
                </Label>
                <input
                  id="drawer-year-min"
                  type="number"
                  min={0}
                  placeholder={facets ? String(facets.yearMin || "") : ""}
                  value={draft.yearMin}
                  onChange={(e) => patchDraft({ yearMin: e.target.value })}
                  className="min-w-0 h-9 w-full rounded-sm border border-border-default bg-bg-card px-3 font-mono text-sm text-text-primary focus:border-accent-warm focus:outline-none"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="drawer-year-max" className="font-sans text-xs text-text-secondary">
                  To
                </Label>
                <input
                  id="drawer-year-max"
                  type="number"
                  min={0}
                  placeholder={facets ? String(facets.yearMax || "") : ""}
                  value={draft.yearMax}
                  onChange={(e) => patchDraft({ yearMax: e.target.value })}
                  className="min-w-0 h-9 w-full rounded-sm border border-border-default bg-bg-card px-3 font-mono text-sm text-text-primary focus:border-accent-warm focus:outline-none"
                />
              </div>
            </div>
          </DrawerSection>

          <DrawerSection title="Mileage (km)">
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label htmlFor="drawer-mileage-min" className="font-sans text-xs text-text-secondary">
                  Min
                </Label>
                <input
                  id="drawer-mileage-min"
                  type="number"
                  min={0}
                  placeholder="0"
                  value={draft.mileageMin}
                  onChange={(e) => patchDraft({ mileageMin: e.target.value })}
                  className="min-w-0 h-9 w-full rounded-sm border border-border-default bg-bg-card px-3 font-mono text-sm text-text-primary focus:border-accent-warm focus:outline-none"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="drawer-mileage-max" className="font-sans text-xs text-text-secondary">
                  Max
                </Label>
                <input
                  id="drawer-mileage-max"
                  type="number"
                  min={0}
                  placeholder={mileageMaxPlaceholder}
                  value={draft.mileageMax}
                  onChange={(e) => patchDraft({ mileageMax: e.target.value })}
                  className="min-w-0 h-9 w-full rounded-sm border border-border-default bg-bg-card px-3 font-mono text-sm text-text-primary focus:border-accent-warm focus:outline-none"
                />
              </div>
            </div>
          </DrawerSection>

          <DrawerSection title="Body type">
            <div
              className={cn(
                bodyOptions.length <= 6
                  ? "flex flex-wrap gap-2"
                  : "flex flex-col gap-2",
              )}
            >
              {bodyOptions.map((opt) => (
                <PillToggle
                  key={opt}
                  label={opt}
                  selected={draft.bodyTypes.includes(opt)}
                  onClick={() =>
                    patchDraft({ bodyTypes: toggleInList(draft.bodyTypes, opt) })
                  }
                />
              ))}
            </div>
          </DrawerSection>

          <DrawerSection title="Transmission">
            <div
              className={cn(
                transmissionOptions.length <= 6
                  ? "flex flex-wrap gap-2"
                  : "flex flex-col gap-2",
              )}
            >
              {transmissionOptions.map((opt) => (
                <PillToggle
                  key={opt}
                  label={opt}
                  selected={draft.transmissions.includes(opt)}
                  onClick={() =>
                    patchDraft({ transmissions: toggleInList(draft.transmissions, opt) })
                  }
                />
              ))}
            </div>
          </DrawerSection>

          <DrawerSection title="Condition">
            <div className="flex flex-wrap gap-2">
              {CONDITION_OPTIONS.map((opt) => (
                <PillToggle
                  key={opt}
                  label={opt}
                  selected={draft.conditions.includes(opt)}
                  onClick={() =>
                    patchDraft({ conditions: toggleInList(draft.conditions, opt) })
                  }
                />
              ))}
            </div>
          </DrawerSection>

          <DrawerSection title="Vehicle type">
            <div className="flex flex-wrap gap-2">
              {VEHICLE_TYPE_OPTIONS.map((opt) => (
                <PillToggle
                  key={opt}
                  label={opt}
                  selected={draft.vehicleTypes.includes(opt)}
                  onClick={() =>
                    patchDraft({ vehicleTypes: toggleInList(draft.vehicleTypes, opt) })
                  }
                />
              ))}
            </div>
          </DrawerSection>

          <DrawerSection title="Location">
            <input
              id="drawer-location"
              type="text"
              value={draft.location}
              onChange={(e) => patchDraft({ location: e.target.value })}
              placeholder="City, region, or country"
              className="w-full min-h-11 rounded-sm border border-border-default bg-bg-card px-4 py-3 font-sans text-sm text-text-primary placeholder:text-text-tertiary focus:border-accent-warm focus:outline-none focus-visible:shadow-[var(--focus-ring)]"
            />
          </DrawerSection>

          <DrawerSection title="Colour">
            <input
              id="drawer-colour"
              type="text"
              value={draft.colour}
              onChange={(e) => patchDraft({ colour: e.target.value })}
              placeholder="e.g. Blue, Red"
              className="w-full min-h-11 rounded-sm border border-border-default bg-bg-card px-4 py-3 font-sans text-sm text-text-primary placeholder:text-text-tertiary focus:border-accent-warm focus:outline-none focus-visible:shadow-[var(--focus-ring)]"
            />
          </DrawerSection>
        </div>

        <SheetFooter className="sticky bottom-0 border-t border-border-default bg-bg-card px-4 py-4">
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
            disabled={showResultsDisabled}
            title={showResultsDisabled ? "Waiting for exchange rates…" : undefined}
            onClick={() => {
              const hasPriceBounds = Boolean(draft.priceMin || draft.priceMax);
              pushFilters({
                ...draft,
                priceCurrency: hasPriceBounds ? displayCurrency : "",
                page: 1,
              });
              onOpenChange(false);
            }}
          >
            Show results{facets ? ` (${facets.totalActive})` : ""}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

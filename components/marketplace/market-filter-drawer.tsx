"use client";

import { useState } from "react";

import { PlacePicker } from "@/components/geo/place-picker";
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
import { useMarketRatesRequest } from "@/hooks/use-market-rates-request";
import { useMarketFilterNavigation } from "@/hooks/use-market-filters";
import { useDisplayCurrency } from "@/lib/marketplace/display-currency-context";
import { pickPartialFxRates } from "@/lib/marketplace/fx-rate-registry";
import {
  DEFAULT_MARKET_FILTERS,
  priceFilterPlaceholder,
  type MarketFilterState,
  type VerificationFilter,
} from "@/lib/marketplace/filter-params";
import type { PassportLocationSelection } from "@/lib/passport/metadata-form";
import {
  rateRequiredForPriceCurrency,
  ratesReadyForPriceCurrency,
} from "@/lib/marketplace/price-normalize";
import {
  BODY_TYPE_OPTIONS,
  CONDITION_OPTIONS,
  FUEL_TYPE_OPTIONS,
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
  const { filters, pushFilters } = useMarketFilterNavigation();
  const fxContext = useDisplayCurrency();
  const filterRates = pickPartialFxRates(fxContext);
  const { displayCurrency, isRatesLoading } = fxContext;
  const [draft, setDraft] = useState<MarketFilterState>(filters);

  const filtersKey = JSON.stringify(filters);
  const [prevFiltersKey, setPrevFiltersKey] = useState(filtersKey);
  if (open && filtersKey !== prevFiltersKey) {
    setPrevFiltersKey(filtersKey);
    setDraft(filters);
  }

  const handleOpenChange = (next: boolean) => {
    if (next) {
      setDraft(filters);
      setPrevFiltersKey(JSON.stringify(filters));
    }
    onOpenChange(next);
  };

  const fuelOptions = [...FUEL_TYPE_OPTIONS];
  const bodyOptions = [...BODY_TYPE_OPTIONS];
  const transmissionOptions = [...TRANSMISSION_OPTIONS];

  const patchDraft = (patch: Partial<MarketFilterState>) => {
    setDraft((prev) => ({ ...prev, ...patch }));
  };

  const pricePlaceholder = priceFilterPlaceholder(displayCurrency);
  const draftHasPriceBounds = Boolean(draft.priceMin || draft.priceMax);
  const showResultsNeedsRates =
    draftHasPriceBounds && rateRequiredForPriceCurrency(displayCurrency);
  const showResultsDisabled =
    showResultsNeedsRates &&
    (isRatesLoading || !ratesReadyForPriceCurrency(displayCurrency, filterRates));

  useMarketRatesRequest(showResultsNeedsRates && open);

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
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
                  placeholder={pricePlaceholder}
                  value={draft.priceMin}
                  onChange={(e) => patchDraft({ priceMin: e.target.value })}
                  className="min-w-0 min-h-11 w-full rounded-sm border border-border-default bg-bg-card px-3 font-mono text-sm text-text-primary focus:border-accent-warm focus:outline-none"
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
                  placeholder={pricePlaceholder}
                  value={draft.priceMax}
                  onChange={(e) => patchDraft({ priceMax: e.target.value })}
                  className="min-w-0 min-h-11 w-full rounded-sm border border-border-default bg-bg-card px-3 font-mono text-sm text-text-primary focus:border-accent-warm focus:outline-none"
                />
              </div>
            </div>
          </DrawerSection>

          <DrawerSection title="Make">
            <FilterCombobox
              id="drawer-filter-make"
              value={draft.make}
              options={[]}
              placeholder="Search makes…"
              onChange={(make) => patchDraft({ make, model: "" })}
            />
          </DrawerSection>

          {draft.make && (
            <DrawerSection title="Model">
              <FilterCombobox
                id="drawer-filter-model"
                value={draft.model}
                options={[]}
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
                  placeholder=""
                  value={draft.yearMin}
                  onChange={(e) => patchDraft({ yearMin: e.target.value })}
                  className="min-w-0 min-h-11 w-full rounded-sm border border-border-default bg-bg-card px-3 font-mono text-sm text-text-primary focus:border-accent-warm focus:outline-none"
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
                  placeholder=""
                  value={draft.yearMax}
                  onChange={(e) => patchDraft({ yearMax: e.target.value })}
                  className="min-w-0 min-h-11 w-full rounded-sm border border-border-default bg-bg-card px-3 font-mono text-sm text-text-primary focus:border-accent-warm focus:outline-none"
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
                  className="min-w-0 min-h-11 w-full rounded-sm border border-border-default bg-bg-card px-3 font-mono text-sm text-text-primary focus:border-accent-warm focus:outline-none"
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
                  placeholder=""
                  value={draft.mileageMax}
                  onChange={(e) => patchDraft({ mileageMax: e.target.value })}
                  className="min-w-0 min-h-11 w-full rounded-sm border border-border-default bg-bg-card px-3 font-mono text-sm text-text-primary focus:border-accent-warm focus:outline-none"
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
            <PlacePicker
              id="drawer-location"
              label=""
              value={
                draft.placeId
                  ? ({
                      placeId: draft.placeId,
                      label: draft.placeLabel || draft.placeId,
                      countryCode: draft.placeCountryCode,
                      city: draft.placeLabel || draft.placeId,
                    } satisfies PassportLocationSelection)
                  : null
              }
              onChange={(selection: PassportLocationSelection | null) => {
                if (!selection) {
                  patchDraft({
                    placeId: "",
                    placeLabel: "",
                    placeCountryCode: "",
                  });
                  return;
                }
                patchDraft({
                  placeId: selection.placeId,
                  placeLabel: selection.label,
                  placeCountryCode: selection.countryCode,
                });
              }}
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
            Show results
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

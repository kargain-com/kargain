"use client";

import { Search } from "lucide-react";
import { useMemo, useState } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { shellControlHover, narrativeEyebrow } from "@/lib/design/instrument-classes";
import { DISPLAY_CURRENCIES } from "@/lib/marketplace/currency-code";
import {
  type DisplayCurrency,
  useDisplayCurrency,
} from "@/lib/marketplace/display-currency-context";
import { useMarketRatesRequest } from "@/hooks/use-market-rates-request";
import { isCryptoDisplayCurrency } from "@/lib/marketplace/currency-code";
import { CRYPTO_DISPLAY_CONFIG } from "@/lib/marketplace/fx-rate-registry";
import { fiatCurrencySymbol } from "@/lib/marketplace/fiat-format";
import { cn } from "@/lib/utils";

const OPTIONS = DISPLAY_CURRENCIES.map((value) => ({ value }));

const FIAT_OPTIONS = OPTIONS.filter((option) => !isCryptoDisplayCurrency(option.value));
const CRYPTO_OPTIONS = OPTIONS.filter((option) => isCryptoDisplayCurrency(option.value));

function currencyOptionSymbol(code: DisplayCurrency): string {
  if (isCryptoDisplayCurrency(code)) return CRYPTO_DISPLAY_CONFIG[code].selectorSymbol;
  const symbol = fiatCurrencySymbol(code);
  return symbol === code ? "" : symbol;
}

function CurrencyOptionLabel({ code }: { code: DisplayCurrency }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span
        className="inline-block w-6 shrink-0 text-right font-mono text-text-secondary"
        aria-hidden
      >
        {currencyOptionSymbol(code) || "\u00A0"}
      </span>
      <span>{code}</span>
    </span>
  );
}

function CurrencyDropdownCell({
  code,
  selected,
  onSelect,
}: {
  code: DisplayCurrency;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <DropdownMenuItem
      className={cn(
        "cursor-pointer px-2.5 py-2 font-sans text-sm",
        selected && "text-accent-warm",
      )}
      onSelect={onSelect}
    >
      <CurrencyOptionLabel code={code} />
    </DropdownMenuItem>
  );
}

function CurrencySheetCell({
  code,
  selected,
  onSelect,
}: {
  code: DisplayCurrency;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      className={cn(
        "flex min-h-11 items-center rounded-sm px-2.5 font-sans text-sm transition-colors duration-200",
        selected ? "bg-bg-surface text-accent-warm" : "text-text-primary",
      )}
      onClick={onSelect}
    >
      <CurrencyOptionLabel code={code} />
    </button>
  );
}

function CurrencySearchField({
  query,
  onQueryChange,
  className,
}: {
  query: string;
  onQueryChange: (value: string) => void;
  className?: string;
}) {
  return (
    <div className={cn("relative", className)}>
      <Search
        className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-text-tertiary"
        strokeWidth={1.5}
        aria-hidden
      />
      <Input
        type="text"
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        placeholder="Search currency"
        className="h-9 min-h-9 py-2 pl-8 text-sm"
        onKeyDown={(event) => event.stopPropagation()}
      />
    </div>
  );
}

function CurrencyPickerGroups({
  displayCurrency,
  filteredFiat,
  filteredCrypto,
  noResults,
  query,
  onSelect,
  variant,
}: {
  displayCurrency: DisplayCurrency;
  filteredFiat: typeof FIAT_OPTIONS;
  filteredCrypto: typeof CRYPTO_OPTIONS;
  noResults: boolean;
  query: string;
  onSelect: (currency: DisplayCurrency) => void;
  variant: "dropdown" | "sheet";
}) {
  const Cell = variant === "dropdown" ? CurrencyDropdownCell : CurrencySheetCell;

  return (
    <>
      {filteredFiat.length > 0 && (
        <>
          <p className={cn(narrativeEyebrow, "mb-1.5 mt-2 px-1")}>Fiat</p>
          <div className="grid grid-cols-2 gap-0.5">
            {filteredFiat.map((option) => (
              <Cell
                key={option.value}
                code={option.value}
                selected={displayCurrency === option.value}
                onSelect={() => onSelect(option.value)}
              />
            ))}
          </div>
        </>
      )}

      {filteredCrypto.length > 0 && (
        <>
          <p className={cn(narrativeEyebrow, "mb-1.5 mt-3 px-1")}>Crypto</p>
          <div className="grid grid-cols-2 gap-0.5">
            {filteredCrypto.map((option) => (
              <Cell
                key={option.value}
                code={option.value}
                selected={displayCurrency === option.value}
                onSelect={() => onSelect(option.value)}
              />
            ))}
          </div>
        </>
      )}

      {noResults && (
        <p className="px-1 py-5 text-center text-sm text-text-tertiary">
          No currency matches &quot;{query}&quot;
        </p>
      )}
    </>
  );
}

const triggerClassName = cn(
  "inline-flex h-9 w-[72px] shrink-0 items-center justify-center rounded-sm border border-border-hover bg-transparent",
  "font-sans text-sm font-medium text-text-primary transition-colors duration-200",
  shellControlHover,
  "focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]",
);

function CurrencyTrigger({
  displayCurrency,
  onClick,
  "aria-haspopup": ariaHasPopup,
  "aria-expanded": ariaExpanded,
}: {
  displayCurrency: DisplayCurrency;
  onClick?: () => void;
  "aria-haspopup"?: boolean | "dialog" | "menu" | "listbox" | "tree" | "grid" | "false";
  "aria-expanded"?: boolean;
}) {
  return (
    <button
      type="button"
      className={triggerClassName}
      aria-label={`Display currency: ${displayCurrency}`}
      aria-haspopup={ariaHasPopup}
      aria-expanded={ariaExpanded}
      onClick={onClick}
    >
      {displayCurrency}
    </button>
  );
}

export function CurrencySelector() {
  const { displayCurrency, setDisplayCurrency } = useDisplayCurrency();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [desktopOpen, setDesktopOpen] = useState(false);
  const [query, setQuery] = useState("");

  useMarketRatesRequest(desktopOpen || mobileOpen);

  const normalizedQuery = query.trim().toUpperCase();

  const filteredFiat = useMemo(
    () =>
      FIAT_OPTIONS.filter(
        (option) => normalizedQuery === "" || option.value.includes(normalizedQuery),
      ),
    [normalizedQuery],
  );

  const filteredCrypto = useMemo(
    () =>
      CRYPTO_OPTIONS.filter(
        (option) => normalizedQuery === "" || option.value.includes(normalizedQuery),
      ),
    [normalizedQuery],
  );

  const noResults = filteredFiat.length === 0 && filteredCrypto.length === 0;

  const selectCurrency = (currency: DisplayCurrency) => {
    setDisplayCurrency(currency);
    setMobileOpen(false);
    setDesktopOpen(false);
    setQuery("");
  };

  return (
    <>
      <div className="hidden md:block">
        <DropdownMenu
          open={desktopOpen}
          onOpenChange={(next) => {
            setDesktopOpen(next);
            if (!next) setQuery("");
          }}
        >
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className={triggerClassName}
              aria-label={`Display currency: ${displayCurrency}`}
            >
              {displayCurrency}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-[308px] p-3">
            <CurrencySearchField query={query} onQueryChange={setQuery} className="mb-1" />
            <CurrencyPickerGroups
              displayCurrency={displayCurrency}
              filteredFiat={filteredFiat}
              filteredCrypto={filteredCrypto}
              noResults={noResults}
              query={query}
              onSelect={selectCurrency}
              variant="dropdown"
            />
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="md:hidden">
        <CurrencyTrigger
          displayCurrency={displayCurrency}
          onClick={() => setMobileOpen(true)}
          aria-haspopup="dialog"
          aria-expanded={mobileOpen}
        />
        <Sheet
          open={mobileOpen}
          onOpenChange={(next) => {
            setMobileOpen(next);
            if (!next) setQuery("");
          }}
        >
          <SheetContent
            side="bottom"
            className="flex flex-col gap-0 p-0 pb-[env(safe-area-inset-bottom)] [&>button.absolute]:hidden"
          >
            <div className="mx-auto mt-3 h-1 w-10 shrink-0 rounded-full bg-border-default" aria-hidden />
            <SheetHeader className="shrink-0 border-b border-border-default px-4 pb-3 pt-2">
              <SheetTitle className="font-sans text-base font-medium normal-case tracking-normal text-text-primary">
                Display currency
              </SheetTitle>
            </SheetHeader>
            <div className="max-h-[90dvh] min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3">
              <CurrencySearchField query={query} onQueryChange={setQuery} className="mb-2" />
              <CurrencyPickerGroups
                displayCurrency={displayCurrency}
                filteredFiat={filteredFiat}
                filteredCrypto={filteredCrypto}
                noResults={noResults}
                query={query}
                onSelect={selectCurrency}
                variant="sheet"
              />
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </>
  );
}

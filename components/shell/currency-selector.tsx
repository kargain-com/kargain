"use client";

import { useState } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { shellControlHover } from "@/lib/design/instrument-classes";
import { DISPLAY_CURRENCIES } from "@/lib/marketplace/currency-code";
import {
  type DisplayCurrency,
  useDisplayCurrency,
} from "@/lib/marketplace/display-currency-context";
import { isCryptoDisplayCurrency } from "@/lib/marketplace/currency-code";
import { CRYPTO_DISPLAY_CONFIG } from "@/lib/marketplace/fx-rate-registry";
import { fiatCurrencySymbol } from "@/lib/marketplace/fiat-format";
import { cn } from "@/lib/utils";

const OPTIONS = DISPLAY_CURRENCIES.map((value) => ({ value }));

function currencyOptionSymbol(code: DisplayCurrency): string {
  if (isCryptoDisplayCurrency(code)) return CRYPTO_DISPLAY_CONFIG[code].selectorSymbol;
  const symbol = fiatCurrencySymbol(code);
  return symbol === code ? "" : symbol;
}

function CurrencyOptionLabel({
  code,
  selected,
}: {
  code: DisplayCurrency;
  selected: boolean;
}) {
  return (
    <span className="inline-flex items-center gap-2">
      <span
        className={cn(
          "inline-block w-6 shrink-0 text-right font-mono",
          selected ? "text-accent-warm" : "text-text-secondary",
        )}
        aria-hidden
      >
        {currencyOptionSymbol(code) || "\u00A0"}
      </span>
      <span>{code}</span>
    </span>
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

  const selectCurrency = (currency: DisplayCurrency) => {
    setDisplayCurrency(currency);
    setMobileOpen(false);
  };

  return (
    <>
      <div className="hidden md:block">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className={triggerClassName}
              aria-label={`Display currency: ${displayCurrency}`}
            >
              {displayCurrency}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[168px] p-1">
            {OPTIONS.map((option) => (
              <DropdownMenuItem
                key={option.value}
                className={cn(
                  "font-sans text-sm",
                  displayCurrency === option.value && "text-accent-warm",
                )}
                onSelect={() => setDisplayCurrency(option.value)}
              >
                <CurrencyOptionLabel
                  code={option.value}
                  selected={displayCurrency === option.value}
                />
              </DropdownMenuItem>
            ))}
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
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
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
            <div className="max-h-[90dvh] min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 py-2">
              {OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={cn(
                    "flex min-h-11 w-full items-center rounded-sm px-4 font-sans text-sm transition-colors duration-200",
                    displayCurrency === option.value
                      ? "bg-bg-surface text-accent-warm"
                      : "text-text-primary",
                  )}
                  onClick={() => selectCurrency(option.value)}
                >
                  <CurrencyOptionLabel
                    code={option.value}
                    selected={displayCurrency === option.value}
                  />
                </button>
              ))}
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </>
  );
}

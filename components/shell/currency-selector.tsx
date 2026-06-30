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
  SheetTitle,
} from "@/components/ui/sheet";
import { DISPLAY_CURRENCIES } from "@/lib/marketplace/currency-code";
import {
  type DisplayCurrency,
  useDisplayCurrency,
} from "@/lib/marketplace/display-currency-context";
import { fiatCurrencyOptionLabel } from "@/lib/marketplace/fiat-format";
import { cn } from "@/lib/utils";

const OPTIONS: Array<{ value: DisplayCurrency; label: string }> = DISPLAY_CURRENCIES.map(
  (value) => {
    if (value === "ETH") return { value, label: "Ξ ETH" };
    return { value, label: fiatCurrencyOptionLabel(value) };
  },
);

const triggerClassName = cn(
  "inline-flex h-9 w-[72px] shrink-0 items-center justify-center rounded-sm border border-border-hover bg-transparent",
  "font-sans text-sm font-medium text-text-primary transition-colors duration-200",
  "hover:border-accent-warm hover:text-accent-warm",
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
          <DropdownMenuContent align="end" className="min-w-[148px] p-1">
            {OPTIONS.map((option) => (
              <DropdownMenuItem
                key={option.value}
                className={cn(
                  "font-sans text-sm",
                  displayCurrency === option.value && "text-accent-warm",
                )}
                onSelect={() => setDisplayCurrency(option.value)}
              >
                {option.label}
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
            <div className="mx-auto mt-3 h-1 w-10 rounded-full bg-border-default" aria-hidden />
            <SheetTitle className="sr-only">Display currency</SheetTitle>
            <div className="mb-4 mt-4 px-2">
              {OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={cn(
                    "flex h-14 w-full items-center px-4 font-sans text-base font-medium transition-colors duration-200",
                    displayCurrency === option.value
                      ? "bg-bg-surface text-accent-warm"
                      : "text-text-primary",
                  )}
                  onClick={() => selectCurrency(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </>
  );
}

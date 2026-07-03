import {
  isDisplayCurrency,
  type DisplayCurrency,
} from "@/lib/marketplace/currency-code";

export const DISPLAY_CURRENCY_STORAGE_KEY = "kargain_display_currency";

export function displayCurrencyNeedsRates(currency: DisplayCurrency): boolean {
  return currency !== "USD";
}

export function shouldEnableMarketRates(input: {
  displayCurrencyNeedsRates: boolean;
  ephemeralRequests: number;
}): boolean {
  return input.displayCurrencyNeedsRates || input.ephemeralRequests > 0;
}

export function readStoredDisplayCurrency(): DisplayCurrency {
  if (typeof window === "undefined") return "USD";
  const stored = window.localStorage.getItem(DISPLAY_CURRENCY_STORAGE_KEY);
  return stored && isDisplayCurrency(stored) ? stored : "USD";
}

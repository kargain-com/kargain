"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo } from "react";

import {
  DEFAULT_MARKET_FILTERS,
  filtersFromSearchParams,
  filtersToSearchParams,
  type MarketFilterState,
} from "@/lib/marketplace/filter-params";

export function useMarketFilterNavigation() {
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

export function useMarketFiltersFromUrl() {
  const searchParams = useSearchParams();
  return useMemo(() => filtersFromSearchParams(searchParams), [searchParams]);
}

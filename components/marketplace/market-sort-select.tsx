"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { MarketSort } from "@/lib/marketplace/filter-params";
import { cn } from "@/lib/utils";

const SORT_LABELS: Record<MarketSort, string> = {
  newest: "Newest",
  price_asc: "Price: low to high",
  price_desc: "Price: high to low",
  mileage_asc: "Mileage",
};

export function MarketSortSelect({
  sort,
  onSortChange,
  className,
}: {
  sort: MarketSort;
  onSortChange: (sort: MarketSort) => void;
  className?: string;
}) {
  const isDefaultSort = sort === "newest";

  return (
    <Select value={sort} onValueChange={(v) => onSortChange(v as MarketSort)}>
      <SelectTrigger
        className={cn(
          "min-h-11 rounded-sm border border-border-default px-3 font-sans text-sm font-medium",
          isDefaultSort ? "text-text-secondary" : "text-text-primary",
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

import type { VerificationFilter } from "@/lib/marketplace/filter-params";
import { shellControlHover } from "@/lib/design/instrument-classes";

export const STATUS_FILTER_OPTIONS: { value: VerificationFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "VERIFIED", label: "Verified" },
  { value: "UNVERIFIED", label: "Unverified" },
  { value: "DISPUTED", label: "Disputed" },
];

export const FILTER_TRIGGER_BASE =
  `inline-flex items-center gap-1.5 min-h-11 rounded-sm border border-border-default bg-transparent px-3 py-2.5 font-sans text-sm font-medium text-text-primary transition-colors duration-200 focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)] ${shellControlHover}`;

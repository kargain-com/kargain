export type PassportTab = "overview" | "records" | "actions";

const TAB_VALUES: readonly PassportTab[] = ["overview", "records", "actions"];

export function parsePassportTab(param: string | null): PassportTab {
  if (!param) return "overview";
  return TAB_VALUES.includes(param as PassportTab) ? (param as PassportTab) : "overview";
}

/** Set or clear `tab` while preserving other query params (e.g. `e`). */
export function buildPassportTabQuery(
  tab: PassportTab,
  existing: URLSearchParams,
): URLSearchParams {
  const next = new URLSearchParams(existing.toString());
  if (tab === "overview") {
    next.delete("tab");
  } else {
    next.set("tab", tab);
  }
  // Legacy panel params for records/actions no longer used.
  if (next.get("panel") === "records" || next.get("panel") === "actions") {
    next.delete("panel");
  }
  return next;
}

export function passportTabQueryString(tab: PassportTab): string {
  if (tab === "overview") return "";
  return `tab=${encodeURIComponent(tab)}`;
}

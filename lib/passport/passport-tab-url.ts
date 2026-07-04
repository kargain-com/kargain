export type PassportTab = "overview" | "records" | "actions";

const TAB_VALUES: readonly PassportTab[] = ["overview", "records", "actions"];

/** Dispatched after `history.replaceState` so tab UI can sync without App Router navigation. */
export const PASSPORT_TAB_CHANGE_EVENT = "passport-tab-change";

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

/** Instant URL update without Next.js soft navigation (avoids tab-switch jank). */
export function replacePassportTabUrl(
  pathname: string,
  currentSearch: string,
  tab: PassportTab,
): void {
  const next = buildPassportTabQuery(tab, new URLSearchParams(currentSearch));
  const qs = next.toString();
  const url = qs ? `${pathname}?${qs}` : pathname;
  window.history.replaceState(window.history.state, "", url);
  window.dispatchEvent(new Event(PASSPORT_TAB_CHANGE_EVENT));
}

export function readPassportTabFromLocation(): PassportTab {
  if (typeof window === "undefined") return "overview";
  return parsePassportTab(new URLSearchParams(window.location.search).get("tab"));
}

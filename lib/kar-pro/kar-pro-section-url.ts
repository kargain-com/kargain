export type KarProSection = "overview" | "profile" | "fee" | "payments" | "membership";

const SECTION_VALUES: readonly KarProSection[] = [
  "overview",
  "profile",
  "fee",
  "payments",
  "membership",
];

/** Dispatched after `history.replaceState` so section UI can sync without App Router navigation. */
export const KAR_PRO_SECTION_CHANGE_EVENT = "kar-pro-section-change";

export function parseKarProSection(param: string | null): KarProSection {
  if (!param) return "overview";
  if (param === "account") return "membership";
  return SECTION_VALUES.includes(param as KarProSection) ? (param as KarProSection) : "overview";
}

/** Set or clear `section` while preserving other query params. */
export function buildKarProSectionQuery(
  section: KarProSection,
  existing: URLSearchParams,
): URLSearchParams {
  const next = new URLSearchParams(existing.toString());
  if (section === "overview") {
    next.delete("section");
  } else {
    next.set("section", section);
  }
  return next;
}

export function karProSectionQueryString(section: KarProSection): string {
  if (section === "overview") return "";
  return `section=${encodeURIComponent(section)}`;
}

const KAR_PRO_PATH = "/kar-pro";

export function karProSectionHref(section: KarProSection): string {
  if (section === "overview") return KAR_PRO_PATH;
  return `${KAR_PRO_PATH}?${karProSectionQueryString(section)}`;
}

/** Instant URL update without Next.js soft navigation (avoids section-switch jank). */
export function replaceKarProSectionUrl(
  pathname: string,
  currentSearch: string,
  section: KarProSection,
): void {
  const next = buildKarProSectionQuery(section, new URLSearchParams(currentSearch));
  const qs = next.toString();
  const url = qs ? `${pathname}?${qs}` : pathname;
  window.history.replaceState(window.history.state, "", url);
  window.dispatchEvent(new Event(KAR_PRO_SECTION_CHANGE_EVENT));
}

export function readKarProSectionFromLocation(): KarProSection {
  if (typeof window === "undefined") return "overview";
  return parseKarProSection(new URLSearchParams(window.location.search).get("section"));
}

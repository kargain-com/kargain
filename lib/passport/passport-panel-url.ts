export type PassportPanel = "records" | "commerce" | "actions" | "comments";

const PANEL_VALUES: readonly PassportPanel[] = [
  "records",
  "commerce",
  "actions",
  "comments",
];

export function parsePassportPanel(param: string | null): PassportPanel | null {
  if (!param) return null;
  return PANEL_VALUES.includes(param as PassportPanel) ? (param as PassportPanel) : null;
}

/** Set or clear `panel` while preserving other query params. */
export function buildPassportPanelQuery(
  panel: PassportPanel | null,
  existing: URLSearchParams,
): URLSearchParams {
  const next = new URLSearchParams(existing.toString());
  if (panel) {
    next.set("panel", panel);
  } else {
    next.delete("panel");
  }
  return next;
}

export function passportPanelQueryString(panel: PassportPanel | null): string {
  if (!panel) return "";
  return `panel=${encodeURIComponent(panel)}`;
}

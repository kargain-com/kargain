/** Shared query parsing for `/api/geo/*` routes. */

export function parseGeoLangParam(raw: string | null): {
  ok: true;
  lang?: string;
} | { ok: false } {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return { ok: true };
  if (trimmed.length < 2 || trimmed.length > 5) return { ok: false };
  if (!/^[a-zA-Z-]+$/.test(trimmed)) return { ok: false };
  return { ok: true, lang: trimmed.toLowerCase() };
}

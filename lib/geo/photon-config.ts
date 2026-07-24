/** Default public Photon host — only referenced from this module + adapter tests. */
export const DEFAULT_PHOTON_BASE_URL = "https://photon.komoot.io";

export function resolvePhotonBaseUrl(
  envValue: string | undefined = process.env.PHOTON_BASE_URL,
): string {
  const raw = (envValue ?? "").trim() || DEFAULT_PHOTON_BASE_URL;
  return raw.replace(/\/+$/, "");
}

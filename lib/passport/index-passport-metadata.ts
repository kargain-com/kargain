import { parseMetadataJson } from "@/lib/passport/parse-metadata-json";

export type IndexedPassportMetadata = {
  vin: string;
  make: string;
  model: string;
  year: number;
  mileageKm: number;
  fuelType: string;
  bodyType: string;
  transmission: string;
};

export function arUriToHttp(uri: string): string | null {
  const u = uri.trim();
  if (!u.startsWith("ar://")) return null;
  return `https://arweave.net/${u.slice("ar://".length)}`;
}

export async function fetchMetadataFromUri(
  tokenUri: string,
): Promise<IndexedPassportMetadata | null> {
  const url = arUriToHttp(tokenUri);
  if (!url) return null;

  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const json: unknown = await res.json();
    const parsed = parseMetadataJson(json);
    if (!parsed) return null;
    return {
      vin: parsed.vin,
      make: parsed.make,
      model: parsed.model,
      year: parsed.year ?? 0,
      mileageKm: parsed.mileageKm ?? 0,
      fuelType: parsed.fuelType ?? "",
      bodyType: parsed.bodyType ?? "",
      transmission: parsed.transmission ?? "",
    };
  } catch {
    return null;
  }
}

export const DISPUTE_WITHDRAWN_PREFIX = "[dispute-withdrawn]";

export function isDisputeWithdrawnRecord(
  recordType: string,
  description: string,
  author: string,
  lastDisputer: string,
): boolean {
  if (recordType !== "discrepancy") return false;
  if (!lastDisputer || author.toLowerCase() !== lastDisputer.toLowerCase()) {
    return false;
  }
  return description.trim().startsWith(DISPUTE_WITHDRAWN_PREFIX);
}

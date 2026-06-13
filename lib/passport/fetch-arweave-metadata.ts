export type PassportMetadata = {
  name?: string;
  make: string;
  model: string;
  year: number | null;
  vin: string;
  mileageKm: number | null;
  fuelType: string;
  bodyType: string;
  transmission: string;
  description: string;
  photos: string[];
};

function arUriToHttp(uri: string): string | null {
  const u = uri.trim();
  if (!u.startsWith("ar://")) return null;
  return `https://arweave.net/${u.slice("ar://".length)}`;
}

function readString(obj: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const v = obj[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

function readNumber(obj: Record<string, unknown>, ...keys: string[]): number | null {
  for (const key of keys) {
    const v = obj[key];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.trim()) {
      const n = Number.parseInt(v, 10);
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

function readPhotos(obj: Record<string, unknown>): string[] {
  const raw = obj.photos;
  if (!Array.isArray(raw)) return [];
  return raw.filter((p): p is string => typeof p === "string" && p.trim().length > 0);
}

function parseMetadataJson(raw: unknown): PassportMetadata | null {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;

  const make = readString(obj, "make");
  const model = readString(obj, "model");
  const year = readNumber(obj, "year");
  const vin = readString(obj, "vin");
  const mileageKm = readNumber(obj, "mileageKm", "mileage_km");
  const fuelType = readString(obj, "fuelType", "fuel_type");
  const bodyType = readString(obj, "bodyType", "body_type");
  const transmission = readString(obj, "transmission");
  const description = readString(obj, "description");
  const name = readString(obj, "name");
  const photos = readPhotos(obj);

  if (!make && !model && !vin && photos.length === 0) return null;

  return {
    name: name || undefined,
    make,
    model,
    year,
    vin,
    mileageKm,
    fuelType,
    bodyType,
    transmission,
    description,
    photos,
  };
}

export type FetchArweaveMetadataResult =
  | { ok: true; metadata: PassportMetadata }
  | { ok: false };

export async function fetchArweaveMetadata(
  tokenUri: string,
): Promise<FetchArweaveMetadataResult> {
  const url = arUriToHttp(tokenUri);
  if (!url) return { ok: false };

  try {
    const res = await fetch(url, { next: { revalidate: 300 } });
    if (!res.ok) return { ok: false };
    const json: unknown = await res.json();
    const metadata = parseMetadataJson(json);
    if (!metadata) return { ok: false };
    return { ok: true, metadata };
  } catch {
    return { ok: false };
  }
}

import {
  BODY_TYPE_OPTIONS,
  FUEL_TYPE_OPTIONS,
  TRANSMISSION_OPTIONS,
} from "@/lib/passport/metadata-form-options";
import { VINCENT_DATASET } from "@/lib/passport/vincent-dataset";

export type VinDecodedFieldKey =
  | "model"
  | "modelVariant"
  | "bodyType"
  | "fuelType"
  | "transmission"
  | "engine";

export type VinDecodedFields = Partial<Record<VinDecodedFieldKey, string>>;

type DecodeFn = (
  vin: string,
  options?: { year?: number },
) => Promise<{
  attributes: Array<{
    attribute: string;
    value: string | null;
    ambiguous: boolean;
  }>;
}>;

export type DecodeVinFieldsDeps = {
  decode?: DecodeFn;
};

type FuelOption = (typeof FUEL_TYPE_OPTIONS)[number];
type BodyOption = (typeof BODY_TYPE_OPTIONS)[number];
type TransmissionOption = (typeof TRANSMISSION_OPTIONS)[number];

const resultCache = new Map<string, VinDecodedFields | null>();

let decoderPromise: Promise<DecodeFn> | null = null;

async function getDefaultDecode(): Promise<DecodeFn> {
  if (!decoderPromise) {
    decoderPromise = (async () => {
      const [{ createDecoder }, { createArweaveGetLeaf }] = await Promise.all([
        import("@kargain/vincent/decoder"),
        import("@kargain/vincent/arweave"),
      ]);
      const getLeaf = createArweaveGetLeaf({
        gatewayUrl: VINCENT_DATASET.gatewayUrl,
        graphqlUrl: VINCENT_DATASET.graphqlUrl,
        publisher: VINCENT_DATASET.publisher,
        // Descriptor stores the Epoch tag as string; Vincent API takes number.
        epoch: Number(VINCENT_DATASET.arweaveEpochTag),
      });
      const decoder = createDecoder({
        merkleRoot: VINCENT_DATASET.merkleRoot,
        getLeaf,
      });
      return (vin, options) => decoder.decode(vin, options);
    })();
  }
  return decoderPromise;
}

/** Map a raw vPIC fuel string to a form option, or null if unmapped. */
export function mapVpicFuelType(raw: string): FuelOption | null {
  const value = raw.trim();
  if (!value) return null;

  if (/Hybrid|HEV|PHEV/i.test(value)) return "Hybrid";
  if (/Diesel/i.test(value)) return "Diesel";
  if (/Electric/i.test(value)) return "Electric";
  if (
    /Gasoline/i.test(value) &&
    !/E85|Flexible|Flex/i.test(value)
  ) {
    return "Petrol";
  }
  return null;
}

/** Map a raw vPIC body-type string to a form option, or null if unmapped. */
export function mapVpicBodyType(raw: string): BodyOption | null {
  const value = raw.trim();
  if (!value) return null;

  if (/Sedan\/Saloon/i.test(value) || /^Sedan$/i.test(value)) return "Sedan";
  if (/SUV|MPV/i.test(value)) return "SUV";
  if (/Hatchback|Liftback/i.test(value)) return "Hatchback";
  if (/Coupe/i.test(value)) return "Coupe";
  if (/Van|Minivan/i.test(value)) return "Van";
  if (/Pickup/i.test(value)) return "Truck";
  return null;
}

/** Map a raw vPIC transmission string to a form option, or null if unmapped. */
export function mapVpicTransmission(raw: string): TransmissionOption | null {
  const value = raw.trim();
  if (!value) return null;

  if (/Manual/i.test(value)) return "Manual";
  if (/Automatic|CVT/i.test(value)) return "Automatic";
  return null;
}

function mapAttributesToFields(
  attributes: Array<{
    attribute: string;
    value: string | null;
    ambiguous: boolean;
  }>,
): VinDecodedFields {
  const fields: VinDecodedFields = {};

  for (const attr of attributes) {
    if (attr.value == null || attr.ambiguous) continue;
    const trimmed = attr.value.trim();
    if (!trimmed) continue;

    switch (attr.attribute) {
      case "model":
        fields.model = trimmed;
        break;
      case "series":
        fields.modelVariant = trimmed;
        break;
      case "engine":
        fields.engine = trimmed;
        break;
      case "fuelType": {
        const mapped = mapVpicFuelType(trimmed);
        if (mapped) fields.fuelType = mapped;
        break;
      }
      case "bodyType": {
        const mapped = mapVpicBodyType(trimmed);
        if (mapped) fields.bodyType = mapped;
        break;
      }
      case "transmission": {
        const mapped = mapVpicTransmission(trimmed);
        if (mapped) fields.transmission = mapped;
        break;
      }
      default:
        break;
    }
  }

  return fields;
}

/**
 * Lazy Merkle-verified VIN attribute decode. Fail-silent: returns null on any
 * error. Uses an in-memory per-VIN cache so retyping the same VIN does not refetch.
 */
export async function decodeVinFields(
  normalizedVin: string,
  yearHint: number | null,
  deps?: DecodeVinFieldsDeps,
): Promise<VinDecodedFields | null> {
  const cacheKey =
    yearHint != null ? `${normalizedVin}:${yearHint}` : normalizedVin;

  if (resultCache.has(cacheKey)) {
    return resultCache.get(cacheKey) ?? null;
  }

  try {
    const decode = deps?.decode ?? (await getDefaultDecode());
    const result = await decode(
      normalizedVin,
      yearHint != null ? { year: yearHint } : undefined,
    );
    const fields = mapAttributesToFields(result.attributes);
    resultCache.set(cacheKey, fields);
    return fields;
  } catch {
    resultCache.set(cacheKey, null);
    return null;
  }
}

/** Test-only: clear the per-VIN result cache. */
export function clearVinDecodeCacheForTests(): void {
  resultCache.clear();
}

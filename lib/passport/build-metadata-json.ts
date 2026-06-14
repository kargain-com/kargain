import { METADATA_VERSION } from "@/lib/passport/metadata-constants";
import {
  assertNoPiiKeys,
  normalizeVin,
  type PassportCreateFormInput,
} from "@/lib/passport/metadata-schema";

export type PassportMetadataWire = Record<string, unknown>;

export type BuildMetadataWireOptions = {
  createdAt?: string;
  updatedAt?: string;
};

export function buildDisplayName(year: number, make: string, model: string): string {
  return `${year} ${make.trim()} ${model.trim()}`.trim();
}

export function buildMetadataWire(
  input: PassportCreateFormInput,
  photoUris: string[],
  opts?: BuildMetadataWireOptions,
): PassportMetadataWire {
  const now = new Date().toISOString();
  const createdAt = opts?.createdAt ?? now;
  const updatedAt = opts?.updatedAt ?? now;

  const yearNum = Number.parseInt(input.year, 10);
  const mileageKm = input.mileage.trim() ? Number.parseInt(input.mileage, 10) : 0;

  const wire: PassportMetadataWire = {
    version: METADATA_VERSION,
    name: buildDisplayName(yearNum, input.make, input.model),
    vin: normalizeVin(input.vin),
    make: input.make.trim(),
    model: input.model.trim(),
    year: yearNum,
    mileageKm,
    photos: photoUris,
    createdAt,
    updatedAt,
  };

  const description = input.description.trim();
  if (description) wire.description = description;

  assertNoPiiKeys(wire);
  return wire;
}

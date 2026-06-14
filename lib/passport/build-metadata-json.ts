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

export type PassportEditFormInput = PassportCreateFormInput & {
  type: string;
  colour: string;
  modelVariant: string;
  power: string;
  locationLabel: string;
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

export function buildMetadataWireForEdit(
  input: PassportEditFormInput,
  photoUris: string[],
  opts: { createdAt: string; updatedAt?: string },
): PassportMetadataWire {
  const wire = buildMetadataWire(input, photoUris, opts);
  if (input.type.trim()) wire.type = input.type.trim();
  if (input.colour.trim()) wire.colour = input.colour.trim();
  if (input.modelVariant.trim()) wire.modelVariant = input.modelVariant.trim();
  if (input.power.trim()) wire.power = input.power.trim();
  if (input.locationLabel.trim()) {
    wire.location = { label: input.locationLabel.trim() };
  }
  assertNoPiiKeys(wire);
  return wire;
}

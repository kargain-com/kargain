import { METADATA_VERSION } from "@/lib/passport/metadata-constants";
import type { PassportOptionalFormFields } from "@/lib/passport/metadata-form";
import {
  assertNoPiiKeys,
  normalizeVin,
  type PassportCreateFormInput,
  type PassportMetadata,
} from "@/lib/passport/metadata-schema";
import { parseMetadataJson } from "@/lib/passport/parse-metadata-json";

export type PassportMetadataWire = Record<string, unknown>;

export type BuildMetadataWireOptions = {
  createdAt?: string;
  updatedAt?: string;
};

export type PassportEditFormInput = PassportCreateFormInput;

export { type PassportCreateFormInput } from "@/lib/passport/metadata-schema";

export function buildDisplayName(year: number, make: string, model: string): string {
  return `${year} ${make.trim()} ${model.trim()}`.trim();
}

function parseFeatures(raw: string): string[] {
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function appendOptionalMetadataFields(
  wire: PassportMetadataWire,
  input: PassportOptionalFormFields,
): void {
  if (input.type.trim()) wire.type = input.type.trim();
  if (input.vehicleType.trim()) wire.vehicleType = input.vehicleType.trim();
  if (input.modelVariant.trim()) wire.modelVariant = input.modelVariant.trim();
  if (input.fuelType.trim()) wire.fuelType = input.fuelType.trim();
  if (input.bodyType.trim()) wire.bodyType = input.bodyType.trim();
  if (input.transmission.trim()) wire.transmission = input.transmission.trim();
  if (input.power.trim()) wire.power = input.power.trim();
  if (input.colour.trim()) wire.colour = input.colour.trim();
  if (input.engine.trim()) wire.engine = input.engine.trim();
  if (input.condition.trim()) wire.condition = input.condition.trim();

  if (input.evBatteryKwh.trim()) {
    const n = Number.parseFloat(input.evBatteryKwh);
    if (Number.isFinite(n) && n >= 0) wire.evBatteryKwh = n;
  }

  const features = parseFeatures(input.features);
  if (features.length > 0) wire.features = features;

  const placeId = input.locationPlaceId.trim();
  const countryCode = input.locationCountryCode.trim().toUpperCase();
  const label = input.locationLabel.trim();
  const city = input.locationCity.trim();
  const region = input.locationRegion.trim();

  if (placeId && countryCode.length === 2 && label) {
    const location: Record<string, unknown> = {
      label,
      countryCode,
      placeId,
    };
    if (city) location.city = city;
    if (region) location.region = region;
    wire.location = location;
  }
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

  appendOptionalMetadataFields(wire, input);
  assertNoPiiKeys(wire);
  return wire;
}

export function buildMetadataWireForEdit(
  input: PassportEditFormInput,
  photoUris: string[],
  opts: { createdAt: string; updatedAt?: string },
): PassportMetadataWire {
  return buildMetadataWire(input, photoUris, opts);
}

export function formInputToMetadataPreview(
  input: PassportCreateFormInput,
  photoUris: string[],
  opts?: BuildMetadataWireOptions,
): PassportMetadata {
  const wire = buildMetadataWire(input, photoUris, opts);
  return parseMetadataJson(wire) ?? {
    version: "1.1",
    vin: normalizeVin(input.vin),
    make: input.make.trim(),
    model: input.model.trim(),
    year: Number.parseInt(input.year, 10),
    mileageKm: input.mileage.trim() ? Number.parseInt(input.mileage, 10) : 0,
    photos: photoUris,
  };
}

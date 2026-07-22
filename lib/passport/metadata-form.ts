import type { PassportMetadata } from "@/lib/passport/metadata-schema";

/** All optional v1.1 metadata fields collected in create/edit wizards. */
export type PassportOptionalFormFields = {
  type: string;
  vehicleType: string;
  modelVariant: string;
  fuelType: string;
  bodyType: string;
  transmission: string;
  power: string;
  evBatteryKwh: string;
  colour: string;
  locationLabel: string;
  locationLat: string;
  locationLng: string;
  engine: string;
  features: string;
  condition: string;
};

export type PassportCreateFormInput = {
  vin: string;
  make: string;
  model: string;
  year: string;
  mileage: string;
  description: string;
} & PassportOptionalFormFields;

export type PassportEditFormInput = PassportCreateFormInput;

export type PassportFormFieldKey = keyof PassportCreateFormInput;

export type PassportCreateFormErrors = Partial<
  Record<PassportFormFieldKey | "photos", string>
>;

export function emptyOptionalFormFields(): PassportOptionalFormFields {
  return {
    type: "",
    vehicleType: "",
    modelVariant: "",
    fuelType: "",
    bodyType: "",
    transmission: "",
    power: "",
    evBatteryKwh: "",
    colour: "",
    locationLabel: "",
    locationLat: "",
    locationLng: "",
    engine: "",
    features: "",
    condition: "",
  };
}

export function emptyPassportFormInput(): PassportCreateFormInput {
  return {
    vin: "",
    make: "",
    model: "",
    year: "",
    mileage: "",
    description: "",
    ...emptyOptionalFormFields(),
  };
}

/** Empty baseline when Arweave metadata is unavailable (ownership-first edit). */
export function emptyPassportMetadataBaseline(): PassportMetadata {
  return {
    version: "1.1",
    vin: "",
    make: "",
    model: "",
    year: null,
    mileageKm: null,
    photos: [],
  };
}

/**
 * Init edit wizard form + baseline from loaded metadata or empty when URI is broken.
 */
export function initialEditFormState(metadata: PassportMetadata | null): {
  form: PassportCreateFormInput;
  baseline: PassportMetadata;
  photoUris: string[];
} {
  if (metadata == null) {
    return {
      form: emptyPassportFormInput(),
      baseline: emptyPassportMetadataBaseline(),
      photoUris: [],
    };
  }
  return {
    form: metadataToFormInput(metadata),
    baseline: metadata,
    photoUris: metadata.photos,
  };
}

export function metadataToFormInput(metadata: PassportMetadata): PassportCreateFormInput {
  return {
    vin: metadata.vin,
    make: metadata.make,
    model: metadata.model,
    year: metadata.year != null ? String(metadata.year) : "",
    mileage:
      metadata.mileageKm != null && metadata.mileageKm > 0
        ? String(metadata.mileageKm)
        : "",
    description: metadata.description ?? "",
    type: metadata.type ?? "",
    vehicleType: metadata.vehicleType ?? "",
    modelVariant: metadata.modelVariant ?? "",
    fuelType: metadata.fuelType ?? "",
    bodyType: metadata.bodyType ?? "",
    transmission: metadata.transmission ?? "",
    power: metadata.power ?? "",
    evBatteryKwh:
      metadata.evBatteryKwh != null ? String(metadata.evBatteryKwh) : "",
    colour: metadata.colour ?? "",
    locationLabel: metadata.location?.label ?? "",
    locationLat:
      metadata.location?.lat != null ? String(metadata.location.lat) : "",
    locationLng:
      metadata.location?.lng != null ? String(metadata.location.lng) : "",
    engine: metadata.engine ?? "",
    features: metadata.features?.join(", ") ?? "",
    condition: metadata.condition ?? "",
  };
}

import type { PassportMetadata } from "@/lib/passport/metadata-schema";

/** Selected city for passport form / wire (no lat/lng). */
export type PassportLocationSelection = {
  placeId: string;
  countryCode: string;
  label: string;
  city: string;
  region?: string;
};

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
  locationPlaceId: string;
  locationCountryCode: string;
  locationCity: string;
  locationRegion: string;
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
    locationPlaceId: "",
    locationCountryCode: "",
    locationCity: "",
    locationRegion: "",
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
  const loc = metadata.location;
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
    ...(() => {
      const placeId = loc?.placeId?.trim() ?? "";
      const countryCode = loc?.countryCode?.trim().toUpperCase() ?? "";
      const label = loc?.label?.trim() ?? "";
      if (!placeId || countryCode.length !== 2 || !label) {
        return {
          locationLabel: "",
          locationPlaceId: "",
          locationCountryCode: "",
          locationCity: "",
          locationRegion: "",
        };
      }
      return {
        locationLabel: label,
        locationPlaceId: placeId,
        locationCountryCode: countryCode,
        locationCity: loc?.city?.trim() ?? "",
        locationRegion: loc?.region?.trim() ?? "",
      };
    })(),
    engine: metadata.engine ?? "",
    features: metadata.features?.join(", ") ?? "",
    condition: metadata.condition ?? "",
  };
}

/** Form → selection only when placeId is set (selection-only invariant). */
export function locationSelectionFromForm(
  form: Pick<
    PassportOptionalFormFields,
    | "locationPlaceId"
    | "locationCountryCode"
    | "locationLabel"
    | "locationCity"
    | "locationRegion"
  >,
): PassportLocationSelection | null {
  const placeId = form.locationPlaceId.trim();
  if (!placeId) return null;
  const countryCode = form.locationCountryCode.trim().toUpperCase();
  const label = form.locationLabel.trim();
  const city = form.locationCity.trim() || label;
  if (countryCode.length !== 2 || !label) return null;
  const region = form.locationRegion.trim();
  return {
    placeId,
    countryCode,
    label,
    city,
    ...(region ? { region } : {}),
  };
}

export function locationFieldsFromSelection(
  selection: PassportLocationSelection | null,
): Pick<
  PassportOptionalFormFields,
  | "locationLabel"
  | "locationPlaceId"
  | "locationCountryCode"
  | "locationCity"
  | "locationRegion"
> {
  if (!selection) {
    return {
      locationLabel: "",
      locationPlaceId: "",
      locationCountryCode: "",
      locationCity: "",
      locationRegion: "",
    };
  }
  return {
    locationLabel: selection.label,
    locationPlaceId: selection.placeId,
    locationCountryCode: selection.countryCode,
    locationCity: selection.city,
    locationRegion: selection.region ?? "",
  };
}

/** True when any location form field is non-empty. */
export function hasAnyLocationFormInput(
  form: Pick<
    PassportOptionalFormFields,
    | "locationLabel"
    | "locationPlaceId"
    | "locationCountryCode"
    | "locationCity"
    | "locationRegion"
  >,
): boolean {
  return (
    form.locationLabel.trim() !== "" ||
    form.locationPlaceId.trim() !== "" ||
    form.locationCountryCode.trim() !== "" ||
    form.locationCity.trim() !== "" ||
    form.locationRegion.trim() !== ""
  );
}

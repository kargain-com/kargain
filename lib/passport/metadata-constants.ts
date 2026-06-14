export const METADATA_VERSION = "1.1" as const;
export const LEGACY_METADATA_VERSION = "1.0" as const;

export const MIN_VIN_LENGTH = 11;
export const MAX_VIN_LENGTH = 17;
export const MIN_YEAR = 1900;
export const MAX_PHOTOS = 10;
export const MAX_DESCRIPTION = 500;

/** Mileage delta above this (km) counts as an anchor change in metadata diff. */
export const MILEAGE_ANCHOR_DELTA_KM = 500;

export const ANCHOR_FIELD_KEYS = [
  "vin",
  "make",
  "model",
  "year",
  "mileageKm",
  "type",
  "photos",
] as const;

export type AnchorFieldKey = (typeof ANCHOR_FIELD_KEYS)[number];

/** Keys that must not appear in uploaded metadata JSON (J1). */
export const PII_FIELD_KEYS = ["ownerName", "phone", "email"] as const;

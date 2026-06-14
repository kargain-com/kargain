import { z } from "zod";

import {
  MAX_DESCRIPTION,
  MAX_VIN_LENGTH,
  MIN_VIN_LENGTH,
  MIN_YEAR,
  PII_FIELD_KEYS,
} from "@/lib/passport/metadata-constants";

export const metadataVersionSchema = z.enum(["1.0", "1.1"]);

export const passportLocationSchema = z.object({
  label: z.string().optional(),
  lat: z.number().finite().optional(),
  lng: z.number().finite().optional(),
});

export type PassportLocation = z.infer<typeof passportLocationSchema>;

export const passportMetadataSchema = z.object({
  version: metadataVersionSchema,
  name: z.string().optional(),
  vin: z.string(),
  make: z.string(),
  model: z.string(),
  year: z.number().int().nullable(),
  mileageKm: z.number().int().nonnegative().nullable(),
  photos: z.array(z.string()),
  description: z.string().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
  modelVariant: z.string().optional(),
  type: z.string().optional(),
  vehicleType: z.string().optional(),
  fuelType: z.string().optional(),
  bodyType: z.string().optional(),
  transmission: z.string().optional(),
  power: z.string().optional(),
  evBatteryKwh: z.number().finite().optional(),
  colour: z.string().optional(),
  location: passportLocationSchema.optional(),
  engine: z.string().optional(),
  features: z.array(z.string()).optional(),
  condition: z.string().optional(),
});

export type PassportMetadata = z.infer<typeof passportMetadataSchema>;

export type PassportCreateFormInput = {
  vin: string;
  make: string;
  model: string;
  year: string;
  mileage: string;
  description: string;
};

export type PassportCreateFormErrors = Partial<
  Record<keyof PassportCreateFormInput | "photos", string>
>;

export function normalizeVin(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[^A-HJ-NPR-Z0-9]/g, "")
    .slice(0, MAX_VIN_LENGTH);
}

export function validateCreateFormInput(
  form: PassportCreateFormInput,
): PassportCreateFormErrors {
  const errors: PassportCreateFormErrors = {};
  const vin = form.vin.trim();
  const make = form.make.trim();
  const model = form.model.trim();
  const yearNum = Number.parseInt(form.year, 10);
  const maxYear = new Date().getFullYear() + 1;

  if (!vin) errors.vin = "VIN is required.";
  else if (vin.length < MIN_VIN_LENGTH) {
    errors.vin = `Enter a valid VIN (${MIN_VIN_LENGTH}–${MAX_VIN_LENGTH} characters).`;
  }

  if (!make) errors.make = "Make is required.";
  if (!model) errors.model = "Model is required.";

  if (!form.year.trim()) errors.year = "Year is required.";
  else if (!Number.isFinite(yearNum) || yearNum < MIN_YEAR || yearNum > maxYear) {
    errors.year = `Year must be between ${MIN_YEAR} and ${maxYear}.`;
  }

  if (form.mileage.trim()) {
    const mileageNum = Number.parseInt(form.mileage, 10);
    if (!Number.isFinite(mileageNum) || mileageNum < 0) {
      errors.mileage = "Mileage must be a non-negative whole number.";
    }
  }

  if (form.description.length > MAX_DESCRIPTION) {
    errors.description = `Description must be at most ${MAX_DESCRIPTION} characters.`;
  }

  return errors;
}

const piiKeySet = new Set<string>(PII_FIELD_KEYS);

/** Reject wire JSON objects that include PII keys (J1). */
export function assertNoPiiKeys(obj: Record<string, unknown>): void {
  for (const key of Object.keys(obj)) {
    if (piiKeySet.has(key)) {
      throw new Error(`PII field not allowed in metadata: ${key}`);
    }
  }
}

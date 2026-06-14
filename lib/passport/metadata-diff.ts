import { MILEAGE_ANCHOR_DELTA_KM } from "@/lib/passport/metadata-constants";
import type { PassportMetadata } from "@/lib/passport/metadata-schema";

import type { PonderUriHistoryEntry } from "@/lib/types/ponder";

export type FieldChange = {
  field: string;
  before: string;
  after: string;
};

export type PassportMetadataDiff = {
  anchor: FieldChange[];
  cosmetic: FieldChange[];
};

const COSMETIC_SCALAR_KEYS = [
  "description",
  "modelVariant",
  "colour",
  "power",
  "evBatteryKwh",
  "fuelType",
  "bodyType",
  "transmission",
  "engine",
  "condition",
  "vehicleType",
  "location",
  "features",
] as const;

function formatValue(value: unknown): string {
  if (value == null) return "";
  if (Array.isArray(value)) return JSON.stringify([...value].sort());
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function photosChanged(before: string[], after: string[]): boolean {
  const a = [...before].sort().join("\0");
  const b = [...after].sort().join("\0");
  return a !== b;
}

function mileageIsAnchorChange(before: number | null, after: number | null): boolean {
  if (before == null && after == null) return false;
  if (before == null || after == null) return true;
  return Math.abs(after - before) > MILEAGE_ANCHOR_DELTA_KM;
}

function pushChange(
  bucket: FieldChange[],
  field: string,
  before: unknown,
  after: unknown,
): void {
  const b = formatValue(before);
  const a = formatValue(after);
  if (b === a) return;
  bucket.push({ field, before: b, after: a });
}

export function diffPassportMetadata(
  before: PassportMetadata,
  after: PassportMetadata,
): PassportMetadataDiff {
  const anchor: FieldChange[] = [];
  const cosmetic: FieldChange[] = [];

  for (const field of ["vin", "make", "model", "year", "type"] as const) {
    pushChange(anchor, field, before[field], after[field]);
  }

  if (photosChanged(before.photos, after.photos)) {
    anchor.push({
      field: "photos",
      before: formatValue(before.photos),
      after: formatValue(after.photos),
    });
  }

  if (mileageIsAnchorChange(before.mileageKm, after.mileageKm)) {
    pushChange(anchor, "mileageKm", before.mileageKm, after.mileageKm);
  } else {
    pushChange(cosmetic, "mileageKm", before.mileageKm, after.mileageKm);
  }

  for (const field of COSMETIC_SCALAR_KEYS) {
    pushChange(cosmetic, field, before[field], after[field]);
  }

  return { anchor, cosmetic };
}

export function hasAnchorChanges(diff: PassportMetadataDiff): boolean {
  return diff.anchor.length > 0;
}

export function pickMetadataDiffUris(
  uriHistory: PonderUriHistoryEntry[],
  currentTokenUri: string,
): { beforeUri: string; afterUri: string } | null {
  const sorted = [...uriHistory].sort(
    (a, b) => Number.parseInt(b.timestamp, 10) - Number.parseInt(a.timestamp, 10),
  );
  const latest = sorted[0];
  const afterUri = (latest?.newUri ?? currentTokenUri).trim();
  if (!afterUri) return null;

  let beforeUri = latest?.previousUri?.trim() ?? "";
  if (!beforeUri && sorted.length > 1) {
    beforeUri = sorted[1]?.newUri?.trim() ?? "";
  }
  if (!beforeUri || beforeUri === afterUri) return null;
  return { beforeUri, afterUri };
}

export function recommendsReInspection(params: {
  verificationResetCount: number;
  lastVerificationResetAt: string;
  uriHistory: PonderUriHistoryEntry[];
}): boolean {
  if (params.verificationResetCount > 0) return true;
  const resetAt = Number.parseInt(params.lastVerificationResetAt, 10);
  if (resetAt > 0 && params.uriHistory.some((entry) => entry.verificationReset)) {
    return true;
  }
  return false;
}

/**
 * Raw metadata snapshot types — captured once at ingest observation (S7c-4).
 */

import { createHash } from "node:crypto";

import type { IndexedPassportMetadata } from "@/lib/passport/index-passport-metadata";
import { parseMetadataJson } from "@/lib/passport/parse-metadata-json";

export type MetadataSnapshotStatus = "captured" | "unavailable";

export type MetadataSnapshotDraft = {
  id: string;
  namespace: number;
  uri: string;
  contentSha256: string;
  /** Parsed metadata document when status=captured; absent when unavailable. */
  parsedJson: Record<string, unknown> | null;
  denorm: IndexedPassportMetadata | null;
  sourcePayloadId: string;
  slot: number;
  status: MetadataSnapshotStatus;
};

export function metadataSnapshotRowId(args: {
  namespace: number;
  uri: string;
  contentSha256: string;
}): string {
  return `${args.namespace}:${args.uri}:${args.contentSha256}`;
}

export function sha256Hex(bytes: Buffer | string): string {
  const hash = createHash("sha256");
  hash.update(bytes);
  return hash.digest("hex");
}

export function denormFromParsedJson(
  parsed: Record<string, unknown>,
): IndexedPassportMetadata | null {
  const vin = typeof parsed.vin === "string" ? parsed.vin : "";
  const make = typeof parsed.make === "string" ? parsed.make : "";
  const model = typeof parsed.model === "string" ? parsed.model : "";
  const year = typeof parsed.year === "number" ? parsed.year : 0;
  const mileageKm = typeof parsed.mileageKm === "number" ? parsed.mileageKm : 0;
  const fuelType = typeof parsed.fuelType === "string" ? parsed.fuelType : "";
  const bodyType = typeof parsed.bodyType === "string" ? parsed.bodyType : "";
  const transmission =
    typeof parsed.transmission === "string" ? parsed.transmission : "";
  const condition = typeof parsed.condition === "string" ? parsed.condition : "";
  const vehicleType =
    typeof parsed.vehicleType === "string" ? parsed.vehicleType : "";
  const colour = typeof parsed.colour === "string" ? parsed.colour : "";
  const location =
    parsed.location && typeof parsed.location === "object"
      ? (parsed.location as Record<string, unknown>)
      : null;
  const photos = Array.isArray(parsed.photos)
    ? parsed.photos.filter((p): p is string => typeof p === "string")
    : [];

  return {
    vin,
    make,
    model,
    year,
    mileageKm,
    fuelType,
    bodyType,
    transmission,
    condition,
    vehicleType,
    colour,
    locationLabel:
      location && typeof location.label === "string" ? location.label : "",
    locationPlaceId:
      location && typeof location.placeId === "string" ? location.placeId : "",
    locationCountryCode:
      location && typeof location.countryCode === "string"
        ? location.countryCode
        : "",
    coverPhotoUri: photos[0] ?? "",
  };
}

/** Re-parse denorm from stored raw snapshot (rebuild-safe, no network). */
export function denormFromMetadataSnapshotRow(row: {
  status: string;
  parsed_json: Record<string, unknown> | null;
}): IndexedPassportMetadata | null {
  if (row.status !== "captured" || row.parsed_json == null) return null;
  const parsed = parseMetadataJson(row.parsed_json);
  if (!parsed) return null;
  return denormFromParsedJson(row.parsed_json) ?? {
    vin: parsed.vin,
    make: parsed.make,
    model: parsed.model,
    year: parsed.year ?? 0,
    mileageKm: parsed.mileageKm ?? 0,
    fuelType: parsed.fuelType ?? "",
    bodyType: parsed.bodyType ?? "",
    transmission: parsed.transmission ?? "",
    condition: parsed.condition ?? "",
    vehicleType: parsed.vehicleType ?? "",
    colour: parsed.colour ?? "",
    locationLabel: parsed.location?.label ?? "",
    locationPlaceId: parsed.location?.placeId ?? "",
    locationCountryCode: parsed.location?.countryCode ?? "",
    coverPhotoUri: parsed.photos[0] ?? "",
  };
}

export type MetadataSnapshotRow = {
  id: string;
  namespace: number;
  uri: string;
  content_sha256: string;
  parsed_json: Record<string, unknown> | null;
  source_payload_id: string;
  slot: number;
  status: MetadataSnapshotStatus;
};

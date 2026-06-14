import { LEGACY_METADATA_VERSION, METADATA_VERSION } from "@/lib/passport/metadata-constants";
import {
  normalizeVin,
  type PassportLocation,
  type PassportMetadata,
} from "@/lib/passport/metadata-schema";

function readString(obj: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const v = obj[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

function readNumber(obj: Record<string, unknown>, ...keys: string[]): number | null {
  for (const key of keys) {
    const v = obj[key];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.trim()) {
      const n = Number.parseInt(v, 10);
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

function readStringArray(obj: Record<string, unknown>, key: string): string[] | undefined {
  const raw = obj[key];
  if (!Array.isArray(raw)) return undefined;
  const items = raw.filter((p): p is string => typeof p === "string" && p.trim().length > 0);
  return items.length > 0 ? items : undefined;
}

function readLocation(obj: Record<string, unknown>): PassportLocation | undefined {
  const raw = obj.location;
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const loc = raw as Record<string, unknown>;
  const label = readString(loc, "label");
  const lat = typeof loc.lat === "number" && Number.isFinite(loc.lat) ? loc.lat : undefined;
  const lng = typeof loc.lng === "number" && Number.isFinite(loc.lng) ? loc.lng : undefined;
  if (!label && lat == null && lng == null) return undefined;
  return { label: label || undefined, lat, lng };
}

function readVersion(obj: Record<string, unknown>): "1.0" | "1.1" {
  const v = readString(obj, "version");
  if (v === LEGACY_METADATA_VERSION) return "1.0";
  if (v === METADATA_VERSION) return "1.1";
  return "1.0";
}

export function parseMetadataJson(raw: unknown): PassportMetadata | null {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;

  const make = readString(obj, "make");
  const model = readString(obj, "model");
  const year = readNumber(obj, "year");
  const vinRaw = readString(obj, "vin");
  const vin = vinRaw ? normalizeVin(vinRaw) : "";
  const mileageKm = readNumber(obj, "mileageKm", "mileage_km");
  const fuelType = readString(obj, "fuelType", "fuel_type");
  const bodyType = readString(obj, "bodyType", "body_type");
  const transmission = readString(obj, "transmission");
  const description = readString(obj, "description");
  const name = readString(obj, "name");
  const photos = readStringArray(obj, "photos") ?? [];
  const createdAt = readString(obj, "createdAt", "created_at") || undefined;
  const updatedAt = readString(obj, "updatedAt", "updated_at") || undefined;

  if (!make && !model && !vin && photos.length === 0) return null;

  const metadata: PassportMetadata = {
    version: readVersion(obj),
    vin,
    make,
    model,
    year,
    mileageKm,
    photos,
  };

  if (name) metadata.name = name;
  if (description) metadata.description = description;
  if (fuelType) metadata.fuelType = fuelType;
  if (bodyType) metadata.bodyType = bodyType;
  if (transmission) metadata.transmission = transmission;
  if (createdAt) metadata.createdAt = createdAt;
  if (updatedAt) metadata.updatedAt = updatedAt;

  const modelVariant = readString(obj, "modelVariant");
  if (modelVariant) metadata.modelVariant = modelVariant;

  const type = readString(obj, "type");
  if (type) metadata.type = type;

  const vehicleType = readString(obj, "vehicleType", "vehicle_type");
  if (vehicleType) metadata.vehicleType = vehicleType;

  const power = readString(obj, "power");
  if (power) metadata.power = power;

  const evBattery = readNumber(obj, "evBatteryKwh", "ev_battery_kwh");
  if (evBattery != null) metadata.evBatteryKwh = evBattery;

  const colour = readString(obj, "colour", "color");
  if (colour) metadata.colour = colour;

  const engine = readString(obj, "engine");
  if (engine) metadata.engine = engine;

  const condition = readString(obj, "condition");
  if (condition) metadata.condition = condition;

  const features = readStringArray(obj, "features");
  if (features) metadata.features = features;

  const location = readLocation(obj);
  if (location) metadata.location = location;

  return metadata;
}

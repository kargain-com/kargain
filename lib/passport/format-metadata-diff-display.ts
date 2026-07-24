import { formatMileage } from "@/lib/passport/format-mileage";
import type { FieldChange, PassportMetadataDiff } from "@/lib/passport/metadata-diff";

const DESCRIPTION_PREVIEW_LENGTH = 80;

export const METADATA_FIELD_LABELS: Record<string, string> = {
  vin: "VIN",
  make: "Make",
  model: "Model",
  year: "Year",
  type: "Type",
  mileageKm: "Mileage",
  photos: "Photos",
  description: "Description",
  modelVariant: "Model variant",
  colour: "Colour",
  power: "Power",
  evBatteryKwh: "EV battery",
  fuelType: "Fuel type",
  bodyType: "Body type",
  transmission: "Transmission",
  engine: "Engine",
  condition: "Condition",
  vehicleType: "Vehicle type",
  location: "Location",
  features: "Features",
};

export type PhotoThumb = {
  src: string;
  alt: string;
};

export type PhotoDisplayContext = {
  resolveThumb: (uri: string, index: number) => PhotoThumb | null;
};

export type PhotoChangeSummary = {
  addedCount: number;
  removedCount: number;
  coverChanged: boolean;
  addedThumbs: PhotoThumb[];
  summaryLine: string;
};

export type ScalarDisplayChange = {
  kind: "scalar";
  field: string;
  label: string;
  before: string;
  after: string;
};

export type PhotosDisplayChange = {
  kind: "photos";
  field: "photos";
  label: string;
  summary: PhotoChangeSummary;
};

export type DisplayChange = ScalarDisplayChange | PhotosDisplayChange;

export type MetadataDiffDisplay = {
  identityChanges: DisplayChange[];
  otherChanges: DisplayChange[];
  hasIdentityChanges: boolean;
};

export type FormatMetadataDiffOptions = {
  photoContext?: PhotoDisplayContext;
};

function fieldLabel(field: string): string {
  return METADATA_FIELD_LABELS[field] ?? field;
}

function parsePhotoUris(raw: string): string[] {
  if (!raw.trim()) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
}

function parseScalarRaw(field: string, raw: string): string {
  if (!raw.trim()) return "";
  if (field === "mileageKm") {
    const n = Number.parseInt(raw, 10);
    if (Number.isFinite(n)) return formatMileage(n);
  }
  if (field === "year") {
    const n = Number.parseInt(raw, 10);
    if (Number.isFinite(n)) return String(n);
  }
  if (field === "evBatteryKwh") {
    const n = Number.parseFloat(raw);
    if (Number.isFinite(n)) return `${n} kWh`;
  }
  if (field === "features") {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.filter((item): item is string => typeof item === "string").join(", ");
      }
    } catch {
      return raw;
    }
  }
  if (field === "location") {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const loc = parsed as {
          label?: string;
          city?: string;
          countryCode?: string;
        };
        if (typeof loc.label === "string" && loc.label.trim()) {
          return loc.label.trim();
        }
        const city = typeof loc.city === "string" ? loc.city.trim() : "";
        const country =
          typeof loc.countryCode === "string" ? loc.countryCode.trim() : "";
        if (city && country) return `${city} · ${country}`;
        if (city) return city;
        if (country) return country;
        return raw;
      }
    } catch {
      return raw;
    }
  }
  if (field === "description" && raw.length > DESCRIPTION_PREVIEW_LENGTH) {
    return `${raw.slice(0, DESCRIPTION_PREVIEW_LENGTH).trimEnd()}…`;
  }
  return raw;
}

function formatScalarDisplay(field: string, beforeRaw: string, afterRaw: string): ScalarDisplayChange {
  const before = parseScalarRaw(field, beforeRaw);
  const after = parseScalarRaw(field, afterRaw);
  return {
    kind: "scalar",
    field,
    label: fieldLabel(field),
    before: before || "—",
    after: after || "—",
  };
}

function buildPhotoSummaryLine(addedCount: number, removedCount: number, coverChanged: boolean): string {
  const parts: string[] = [];
  if (addedCount > 0) {
    parts.push(`${addedCount} photo${addedCount === 1 ? "" : "s"} added`);
  }
  if (removedCount > 0) {
    parts.push(`${removedCount} photo${removedCount === 1 ? "" : "s"} removed`);
  }
  if (coverChanged) {
    parts.push("Cover photo changed");
  }
  if (parts.length === 0) {
    return "Photos updated";
  }
  return parts.join(" · ");
}

export function summarizePhotoChanges(
  beforeUris: string[],
  afterUris: string[],
  context?: PhotoDisplayContext,
): PhotoChangeSummary {
  const beforeSet = new Set(beforeUris);
  const afterSet = new Set(afterUris);
  const addedUris = afterUris.filter((uri) => !beforeSet.has(uri));
  const removedCount = beforeUris.filter((uri) => !afterSet.has(uri)).length;
  const coverChanged =
    beforeUris.length > 0 && afterUris.length > 0 && beforeUris[0] !== afterUris[0];

  const addedThumbs: PhotoThumb[] = [];
  if (context) {
    for (const [index, uri] of afterUris.entries()) {
      if (!beforeSet.has(uri)) {
        const thumb = context.resolveThumb(uri, index);
        if (thumb) addedThumbs.push(thumb);
      }
    }
  }

  const addedCount = addedUris.length;

  return {
    addedCount,
    removedCount,
    coverChanged,
    addedThumbs,
    summaryLine: buildPhotoSummaryLine(addedCount, removedCount, coverChanged),
  };
}

function changeToDisplay(change: FieldChange, context?: PhotoDisplayContext): DisplayChange {
  if (change.field === "photos") {
    const beforeUris = parsePhotoUris(change.before);
    const afterUris = parsePhotoUris(change.after);
    return {
      kind: "photos",
      field: "photos",
      label: fieldLabel("photos"),
      summary: summarizePhotoChanges(beforeUris, afterUris, context),
    };
  }
  return formatScalarDisplay(change.field, change.before, change.after);
}

function mapChanges(changes: FieldChange[], context?: PhotoDisplayContext): DisplayChange[] {
  return changes.map((change) => changeToDisplay(change, context));
}

export function formatMetadataDiffForDisplay(
  diff: PassportMetadataDiff,
  options: FormatMetadataDiffOptions = {},
): MetadataDiffDisplay {
  const { photoContext } = options;
  const identityChanges = mapChanges(diff.anchor, photoContext);
  const otherChanges = mapChanges(diff.cosmetic, photoContext);

  return {
    identityChanges,
    otherChanges,
    hasIdentityChanges: identityChanges.length > 0,
  };
}

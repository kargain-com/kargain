import {
  isCompletePlaceSelection,
  parsePlaceSelection,
  placeSelectionToWire,
  type PlaceSelection,
} from "@/lib/geo/place-selection";
import { isValidSlug } from "@/lib/kar-pro/kar-pro-slug-rules";

export type KarProCategoryEnum =
  | "MECHANIC"
  | "GARAGE"
  | "INSPECTOR"
  | "BROKER"
  | "DEALER"
  | "OTHER";

export type KarProMetadata = {
  version: "1.0";
  name: string;
  slug: string;
  category: KarProCategoryEnum;
  description?: string;
  website?: string;
  /** City Place selection — never lat/lng. */
  location?: PlaceSelection;
};

export type KarProProfileFields = {
  categoryIndex: number;
  name: string;
  slug: string;
  description?: string;
  website?: string;
  location?: PlaceSelection | null;
};

export const KAR_PRO_CATEGORY_OPTIONS = [
  { index: 0, label: "Mechanic", enumLabel: "MECHANIC" as const },
  { index: 1, label: "Garage", enumLabel: "GARAGE" as const },
  { index: 2, label: "Inspector", enumLabel: "INSPECTOR" as const },
  { index: 3, label: "Broker", enumLabel: "BROKER" as const },
  { index: 4, label: "Dealer", enumLabel: "DEALER" as const },
  { index: 5, label: "Other", enumLabel: "OTHER" as const },
] as const;

const CATEGORY_ENUMS = new Set<string>(KAR_PRO_CATEGORY_OPTIONS.map((o) => o.enumLabel));

export function categoryIndexToEnum(index: number): KarProCategoryEnum {
  const option = KAR_PRO_CATEGORY_OPTIONS.find((o) => o.index === index);
  return option?.enumLabel ?? "OTHER";
}

export function categoryEnumToIndex(enumLabel: string): number {
  const option = KAR_PRO_CATEGORY_OPTIONS.find((o) => o.enumLabel === enumLabel);
  return option?.index ?? 5;
}

export function categoryIndexToLabel(index: number): string {
  const option = KAR_PRO_CATEGORY_OPTIONS.find((o) => o.index === index);
  return option?.label ?? "Other";
}

export function buildKarProMetadataJson(fields: KarProProfileFields): string {
  const slug = fields.slug.trim();
  if (!isValidSlug(slug)) {
    throw new Error("Invalid slug.");
  }
  const metadata: KarProMetadata = {
    version: "1.0",
    name: fields.name.trim(),
    slug,
    category: categoryIndexToEnum(fields.categoryIndex),
  };
  const description = fields.description?.trim();
  if (description) metadata.description = description;
  const website = fields.website?.trim();
  if (website) metadata.website = website;
  if (fields.location != null && isCompletePlaceSelection(fields.location)) {
    metadata.location = parsePlaceSelection(placeSelectionToWire(fields.location)) ?? undefined;
  }
  return JSON.stringify(metadata);
}

export function parseKarProMetadataJson(json: string): KarProMetadata | null {
  try {
    const parsed: unknown = JSON.parse(json);
    if (!parsed || typeof parsed !== "object") return null;
    const record = parsed as Record<string, unknown>;
    if (record.version !== "1.0") return null;
    if (typeof record.name !== "string" || !record.name.trim()) return null;
    if (typeof record.category !== "string" || !CATEGORY_ENUMS.has(record.category)) return null;

    let slug = "";
    if (typeof record.slug === "string") {
      const trimmed = record.slug.trim();
      if (trimmed && !isValidSlug(trimmed)) return null;
      slug = trimmed;
    }

    const metadata: KarProMetadata = {
      version: "1.0",
      name: record.name.trim(),
      slug,
      category: record.category as KarProCategoryEnum,
    };
    if (typeof record.description === "string" && record.description.trim()) {
      metadata.description = record.description.trim();
    }
    if (typeof record.website === "string" && record.website.trim()) {
      metadata.website = record.website.trim();
    }
    const location = parsePlaceSelection(record.location);
    if (location) metadata.location = location;
    return metadata;
  } catch {
    return null;
  }
}

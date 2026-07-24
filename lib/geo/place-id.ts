export type OsmElementType = "N" | "W" | "R";

const PLACE_ID_RE = /^photon:osm:([NWR])(\d+)$/;

export function buildPhotonOsmPlaceId(
  osmType: string,
  osmId: number | string,
): string | null {
  const type = normalizeOsmType(osmType);
  if (!type) return null;
  const id =
    typeof osmId === "number"
      ? osmId
      : Number.parseInt(String(osmId).trim(), 10);
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  return `photon:osm:${type}${id}`;
}

export function parsePhotonOsmPlaceId(
  placeId: string,
): { osmType: OsmElementType; osmId: number } | null {
  const trimmed = placeId.trim();
  const match = PLACE_ID_RE.exec(trimmed);
  if (!match) return null;
  const osmType = match[1] as OsmElementType;
  const osmId = Number.parseInt(match[2]!, 10);
  if (!Number.isSafeInteger(osmId) || osmId <= 0) return null;
  return { osmType, osmId };
}

function normalizeOsmType(raw: string): OsmElementType | null {
  const t = raw.trim().toUpperCase();
  if (t === "N" || t === "NODE") return "N";
  if (t === "W" || t === "WAY") return "W";
  if (t === "R" || t === "RELATION") return "R";
  return null;
}

import { parseKarProMetadataJson } from "../../lib/kar-pro/kar-pro-metadata";
import { arUriToHttp } from "../../lib/storage/ar-gateway";

function metadataUriToHttp(uri: string): string | null {
  const trimmed = uri.trim();
  if (trimmed.startsWith("ar://")) {
    return arUriToHttp(trimmed);
  }
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return trimmed;
  }
  return null;
}

export type IndexedKarProMetadata = {
  slug: string;
  locationLabel: string;
  locationPlaceId: string;
  locationCountryCode: string;
};

export const EMPTY_INDEXED_KAR_PRO_METADATA: IndexedKarProMetadata = {
  slug: "",
  locationLabel: "",
  locationPlaceId: "",
  locationCountryCode: "",
};

export async function indexKarProMetadataFromUri(
  metadataURI: string,
): Promise<IndexedKarProMetadata> {
  try {
    const url = metadataUriToHttp(metadataURI);
    if (!url) return { ...EMPTY_INDEXED_KAR_PRO_METADATA };

    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return { ...EMPTY_INDEXED_KAR_PRO_METADATA };

    const text = await res.text();
    const metadata = parseKarProMetadataJson(text);
    const location = metadata?.location;
    return {
      slug: metadata?.slug ?? "",
      locationLabel: location?.label ?? "",
      locationPlaceId: location?.placeId ?? "",
      locationCountryCode: location?.countryCode ?? "",
    };
  } catch {
    return { ...EMPTY_INDEXED_KAR_PRO_METADATA };
  }
}

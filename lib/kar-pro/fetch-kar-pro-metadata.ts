import { parseKarProMetadataJson } from "@/lib/kar-pro/kar-pro-metadata";

export type KarProProfileMetadata = {
  slug?: string;
  description?: string;
  website?: string;
};

const ARWEAVE_GATEWAY = (
  process.env.ARWEAVE_GATEWAY ?? "https://arweave.net"
).replace(/\/$/, "");

function metadataUriToHttp(uri: string): string | null {
  const trimmed = uri.trim();
  if (trimmed.startsWith("ar://")) {
    return `${ARWEAVE_GATEWAY}/${trimmed.slice("ar://".length)}`;
  }
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return trimmed;
  }
  return null;
}

export async function fetchKarProMetadata(
  metadataURI: string,
): Promise<KarProProfileMetadata | null> {
  const url = metadataUriToHttp(metadataURI);
  if (!url) return null;

  try {
    const res = await fetch(url, { next: { revalidate: 300 } });
    if (!res.ok) return null;
    const text = await res.text();
    const parsed = parseKarProMetadataJson(text);
    if (!parsed) return null;
    const result: KarProProfileMetadata = {};
    if (parsed.slug) result.slug = parsed.slug;
    if (parsed.description) result.description = parsed.description;
    if (parsed.website) result.website = parsed.website;
    return result;
  } catch {
    return null;
  }
}

export type { PassportMetadata } from "@/lib/passport/metadata-schema";
export { parseMetadataJson } from "@/lib/passport/parse-metadata-json";

import { parseMetadataJson } from "@/lib/passport/parse-metadata-json";
import type { PassportMetadata } from "@/lib/passport/metadata-schema";

function arUriToHttp(uri: string): string | null {
  const u = uri.trim();
  if (!u.startsWith("ar://")) return null;
  return `https://arweave.net/${u.slice("ar://".length)}`;
}

export type FetchArweaveMetadataResult =
  | { ok: true; metadata: PassportMetadata }
  | { ok: false };

export async function fetchArweaveMetadata(
  tokenUri: string,
): Promise<FetchArweaveMetadataResult> {
  const url = arUriToHttp(tokenUri);
  if (!url) return { ok: false };

  try {
    const res = await fetch(url, { next: { revalidate: 300 } });
    if (!res.ok) return { ok: false };
    const json: unknown = await res.json();
    const metadata = parseMetadataJson(json);
    if (!metadata) return { ok: false };
    return { ok: true, metadata };
  } catch {
    return { ok: false };
  }
}

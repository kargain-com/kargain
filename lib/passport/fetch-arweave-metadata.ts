export type { PassportMetadata } from "@/lib/passport/metadata-schema";
export { parseMetadataJson } from "@/lib/passport/parse-metadata-json";

import { parseMetadataJson } from "@/lib/passport/parse-metadata-json";
import type { PassportMetadata } from "@/lib/passport/metadata-schema";
import { arUriToHttp } from "@/lib/storage/ar-gateway";

export type FetchArweaveMetadataResult =
  | { ok: true; metadata: PassportMetadata }
  | { ok: false };

export async function fetchArweaveMetadata(
  tokenUri: string,
  chainId: number,
): Promise<FetchArweaveMetadataResult> {
  const url = arUriToHttp(tokenUri, chainId);
  if (!url) return { ok: false };

  try {
    const init: RequestInit & { next?: { revalidate: number } } = {
      next: { revalidate: 300 },
    };
    const res = await fetch(url, init);
    if (!res.ok) return { ok: false };
    const json: unknown = await res.json();
    const metadata = parseMetadataJson(json);
    if (!metadata) return { ok: false };
    return { ok: true, metadata };
  } catch {
    return { ok: false };
  }
}

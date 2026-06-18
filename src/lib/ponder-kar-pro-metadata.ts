import { parseKarProMetadataJson } from "../../lib/kar-pro/kar-pro-metadata";

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

export async function indexKarProMetadataFromUri(
  metadataURI: string,
): Promise<{ slug: string }> {
  try {
    const url = metadataUriToHttp(metadataURI);
    if (!url) return { slug: "" };

    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return { slug: "" };

    const text = await res.text();
    const metadata = parseKarProMetadataJson(text);
    return { slug: metadata?.slug ?? "" };
  } catch {
    return { slug: "" };
  }
}

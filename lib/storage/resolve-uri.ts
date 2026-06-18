import { arUriToHttp } from "@/lib/storage/ar-gateway";
import { DEFAULT_CHAIN_ID } from "@/lib/web3/supported-chains";

/** Map `ar://` URIs to HTTP gateway URLs for rendering. */
export function resolveUri(uri: string, chainId: number = DEFAULT_CHAIN_ID): string {
  const u = uri.trim();
  if (!u) return u;
  if (u.startsWith("ar://")) {
    return arUriToHttp(u, chainId) ?? u;
  }
  if (/^https?:\/\//i.test(u)) return u;
  return u;
}

/** Normalize a stored id or URI to `ar://{txId}`. */
export function toArUri(ref: string): string {
  const t = ref.trim();
  if (!t) return t;
  if (t.startsWith("ar://")) return t;
  return `ar://${t}`;
}

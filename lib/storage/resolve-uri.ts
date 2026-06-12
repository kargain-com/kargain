const IPFS_GATEWAY = (process.env.IPFS_GATEWAY_URL ?? "https://ipfs.io/ipfs").replace(/\/$/, "");

/** Map `ar://` and `ipfs://` URIs to HTTP gateway URLs for rendering. */
export function resolveUri(uri: string): string {
  const u = uri.trim();
  if (!u) return u;
  if (u.startsWith("ar://")) {
    return `https://arweave.net/${u.slice("ar://".length)}`;
  }
  if (u.startsWith("ipfs://")) {
    return `${IPFS_GATEWAY}/${u.slice("ipfs://".length)}`;
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

import { SimplePool } from "nostr-tools/pool";

import {
  parseProfileContent,
  type NostrProfileData,
} from "@/lib/nostr/parse-profile-content";
import { NOSTR_RELAYS } from "@/lib/nostr/relays";

const SERVER_NOSTR_MAX_WAIT_MS = 3000;

let poolInstance: SimplePool | null = null;

function getPool(): SimplePool {
  if (!poolInstance) {
    poolInstance = new SimplePool();
  }
  return poolInstance;
}

async function fetchKind0ByEthereumTag(
  address: `0x${string}`,
): Promise<NostrProfileData | null> {
  const pool = getPool();
  const tag = `ethereum:${address.toLowerCase()}`;
  const events = await pool.querySync(
    [...NOSTR_RELAYS],
    { kinds: [0], "#i": [tag], limit: 20 },
    { maxWait: SERVER_NOSTR_MAX_WAIT_MS },
  );
  if (events.length === 0) return null;
  const latest = events.sort((a, b) => b.created_at - a.created_at)[0];
  if (!latest) return null;
  return parseProfileContent(latest.content);
}

/** Fetch kind:0 profile for a wallet address from relays (server). Never throws. */
export async function fetchNostrProfileServerFull(
  address: `0x${string}`,
): Promise<NostrProfileData | null> {
  try {
    return await fetchKind0ByEthereumTag(address);
  } catch {
    return null;
  }
}

/** Fetch kind:0 profile picture for a wallet address from relays. Never throws. */
export async function fetchNostrProfileServer(
  address: `0x${string}`,
): Promise<{ picture: string | null }> {
  try {
    const profile = await fetchKind0ByEthereumTag(address);
    const picture = profile?.picture?.trim();
    return { picture: picture || null };
  } catch {
    return { picture: null };
  }
}

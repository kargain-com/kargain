import { SimplePool } from "nostr-tools/pool";

import { NOSTR_RELAYS } from "@/lib/nostr/relays";

let poolInstance: SimplePool | null = null;

function getPool(): SimplePool {
  if (!poolInstance) {
    poolInstance = new SimplePool();
  }
  return poolInstance;
}

function parsePicture(content: string): string | null {
  if (!content.trim()) return null;
  try {
    const raw: unknown = JSON.parse(content);
    if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return null;
    const picture = (raw as Record<string, unknown>).picture;
    return typeof picture === "string" ? picture : null;
  } catch {
    return null;
  }
}

async function resolvePubkeyForAddress(
  address: `0x${string}`,
): Promise<string | null> {
  try {
    const pool = getPool();
    const tag = `ethereum:${address.toLowerCase()}`;
    const events = await pool.querySync(
      [...NOSTR_RELAYS],
      { kinds: [0], "#i": [tag], limit: 20 },
      { maxWait: 4500 },
    );
    if (events.length === 0) return null;
    const latest = events.sort((a, b) => b.created_at - a.created_at)[0];
    return latest?.pubkey ?? null;
  } catch {
    return null;
  }
}

/** Fetch kind:0 profile picture for a wallet address from relays. Never throws. */
export async function fetchNostrProfileServer(
  address: `0x${string}`,
): Promise<{ picture: string | null }> {
  try {
    const pubkey = await resolvePubkeyForAddress(address);
    if (!pubkey) return { picture: null };

    const pool = getPool();
    const events = await pool.querySync(
      [...NOSTR_RELAYS],
      { kinds: [0], authors: [pubkey], limit: 1 },
      { maxWait: 5000 },
    );
    if (events.length === 0) return { picture: null };

    const latest = events.sort((a, b) => b.created_at - a.created_at)[0];
    if (!latest) return { picture: null };

    const picture = parsePicture(latest.content);
    return { picture: picture?.trim() || null };
  } catch {
    return { picture: null };
  }
}

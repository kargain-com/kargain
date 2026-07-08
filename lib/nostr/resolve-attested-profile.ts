import type { Event, Filter } from "nostr-tools";
import { SimplePool } from "nostr-tools/pool";
import type { Address } from "viem";

import { parseProfileContent, type NostrProfileData } from "@/lib/nostr/parse-profile-content";
import { verifyProfileAttestation } from "@/lib/nostr/profile-attestation";
import { NOSTR_RELAYS } from "@/lib/nostr/relays";

const DEFAULT_MAX_WAIT_MS = 3000;
const MAX_PROFILE_BATCH_LIMIT = 500;

export type AttestedProfileQueryPool = Pick<SimplePool, "querySync">;

export type ResolveAttestedProfileOptions = {
  pool?: AttestedProfileQueryPool;
  maxWait?: number;
};

export type VerifiedProfileEntry = {
  address: string;
  createdAt: number;
  profile: NostrProfileData;
  pubkey: string;
  eventId: string;
};

export type AttestedProfileBatchState = {
  byAddress: Map<string, VerifiedProfileEntry>;
};

let serverPoolInstance: SimplePool | null = null;

function getServerPool(): SimplePool {
  if (!serverPoolInstance) {
    serverPoolInstance = new SimplePool();
  }
  return serverPoolInstance;
}

function toWalletAddress(address: Address | `0x${string}`): `0x${string}` {
  return address as `0x${string}`;
}

export function normalizeProfileAddress(address: string): string {
  return address.trim().toLowerCase();
}

function ethereumAddressFromEvent(event: Pick<Event, "tags">): string | null {
  for (const tag of event.tags) {
    if (tag[0] === "i" && typeof tag[1] === "string" && tag[1].startsWith("ethereum:")) {
      const addr = tag[1].slice("ethereum:".length).trim();
      if (addr.length > 0) return normalizeProfileAddress(addr);
    }
  }
  return null;
}

/** Single choke point for NIP-39 ethereum identity tag queries on kind:0. */
function buildAttestedProfileFilter(addresses: Address[]): Filter {
  const tags = [...new Set(addresses.map((a) => `ethereum:${a.toLowerCase()}`))];
  return {
    kinds: [0],
    "#i": tags,
    limit: Math.min(Math.max(tags.length, 1) * 2, MAX_PROFILE_BATCH_LIMIT),
  };
}

export function attestedProfileFilterForAddresses(addresses: Address[]): Filter {
  return buildAttestedProfileFilter(addresses);
}

export function createEmptyAttestedProfileState(): AttestedProfileBatchState {
  return { byAddress: new Map() };
}

export function applyVerifiedProfileEntry(
  state: AttestedProfileBatchState,
  entry: VerifiedProfileEntry,
): AttestedProfileBatchState {
  const existing = state.byAddress.get(entry.address);
  if (existing != null && existing.createdAt >= entry.createdAt) {
    return state;
  }

  const next = new Map(state.byAddress);
  next.set(entry.address, entry);
  return { byAddress: next };
}

export function attestedProfileMapFromState(
  state: AttestedProfileBatchState,
): Map<string, NostrProfileData | null> {
  const result = new Map<string, NostrProfileData | null>();
  for (const [address, entry] of state.byAddress) {
    result.set(address, entry.profile);
  }
  return result;
}

async function pickNewestVerifiedProfile(
  events: Event[],
  expectedAddress?: string,
): Promise<{ event: Event; profile: NostrProfileData } | null> {
  const sorted = [...events].sort((a, b) => b.created_at - a.created_at);
  for (const event of sorted) {
    const address = expectedAddress ?? ethereumAddressFromEvent(event);
    if (!address) continue;

    const verified = await verifyProfileAttestation(
      { id: event.id, pubkey: event.pubkey, content: event.content },
      address as `0x${string}`,
    );
    if (!verified) continue;

    const parsed = parseProfileContent(event.content);
    return { event, profile: parsed ?? {} };
  }
  return null;
}

/** Verify a subscription event; returns null when attestation fails (fail-closed). */
export async function verifyIncomingProfileEvent(
  event: Pick<Event, "id" | "pubkey" | "content" | "created_at" | "tags">,
): Promise<VerifiedProfileEntry | null> {
  try {
    const address = ethereumAddressFromEvent(event);
    if (!address) return null;

    const verified = await verifyProfileAttestation(
      { id: event.id, pubkey: event.pubkey, content: event.content },
      address as `0x${string}`,
    );
    if (!verified) return null;

    const parsed = parseProfileContent(event.content);
    return {
      address,
      createdAt: event.created_at,
      profile: parsed ?? {},
      pubkey: event.pubkey,
      eventId: event.id,
    };
  } catch {
    return null;
  }
}

/** Newest attested kind:0 profile for a wallet address, or null when none verify. */
export async function resolveAttestedProfile(
  walletAddress: Address | `0x${string}`,
  options?: ResolveAttestedProfileOptions,
): Promise<NostrProfileData | null> {
  try {
    const address = toWalletAddress(walletAddress);
    const pool = options?.pool ?? getServerPool();
    const tag = `ethereum:${address.toLowerCase()}`;
    const events = await pool.querySync(
      [...NOSTR_RELAYS],
      { kinds: [0], "#i": [tag], limit: 20 },
      { maxWait: options?.maxWait ?? DEFAULT_MAX_WAIT_MS },
    );
    const picked = await pickNewestVerifiedProfile(events, normalizeProfileAddress(address));
    return picked?.profile ?? null;
  } catch {
    return null;
  }
}

/** Batch variant of resolveAttestedProfile — one entry per requested address. */
export async function resolveAttestedProfiles(
  addresses: Address[],
  options?: ResolveAttestedProfileOptions,
): Promise<Map<string, NostrProfileData | null>> {
  const normalized = [...new Set(addresses.map((a) => normalizeProfileAddress(a)))];
  const result = new Map<string, NostrProfileData | null>();
  if (normalized.length === 0) return result;

  try {
    const pool = options?.pool ?? getServerPool();
    const events = await pool.querySync(
      [...NOSTR_RELAYS],
      buildAttestedProfileFilter(addresses),
      { maxWait: options?.maxWait ?? DEFAULT_MAX_WAIT_MS },
    );

    const eventsByAddress = new Map<string, Event[]>();
    for (const event of events) {
      const addr = ethereumAddressFromEvent(event);
      if (!addr) continue;
      const list = eventsByAddress.get(addr) ?? [];
      list.push(event);
      eventsByAddress.set(addr, list);
    }

    for (const addr of normalized) {
      const candidates = eventsByAddress.get(addr) ?? [];
      const picked = await pickNewestVerifiedProfile(candidates, addr);
      result.set(addr, picked?.profile ?? null);
    }
  } catch {
    for (const addr of normalized) {
      result.set(addr, null);
    }
  }

  return result;
}

/** Server-safe single-address resolver (internal SimplePool). */
export async function resolveAttestedProfileServer(
  address: `0x${string}`,
  options?: Omit<ResolveAttestedProfileOptions, "pool">,
): Promise<NostrProfileData | null> {
  return resolveAttestedProfile(address, options);
}

/** Nostr pubkey from the newest verified kind:0 event for an address. */
export async function attestedPubkeyForAddress(
  address: `0x${string}`,
  options?: ResolveAttestedProfileOptions,
): Promise<string | null> {
  try {
    const pool = options?.pool ?? getServerPool();
    const tag = `ethereum:${address.toLowerCase()}`;
    const events = await pool.querySync(
      [...NOSTR_RELAYS],
      { kinds: [0], "#i": [tag], limit: 20 },
      { maxWait: options?.maxWait ?? DEFAULT_MAX_WAIT_MS },
    );
    const sorted = [...events].sort((a, b) => b.created_at - a.created_at);
    for (const event of sorted) {
      const eventAddress = ethereumAddressFromEvent(event);
      if (!eventAddress) continue;

      const verified = await verifyProfileAttestation(
        { id: event.id, pubkey: event.pubkey, content: event.content },
        eventAddress as `0x${string}`,
      );
      if (verified) return event.pubkey;
    }
    return null;
  } catch {
    return null;
  }
}

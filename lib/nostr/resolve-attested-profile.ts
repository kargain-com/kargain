import type { Event, Filter } from "nostr-tools";
import { SimplePool } from "nostr-tools/pool";
import type { Address } from "viem";

import {
  fetchRelayCoverage,
  getDefaultNostrPool,
  type AppEventQueryPool,
} from "@/lib/nostr/app-event-store";
import {
  loadCachedPubkeyBinding,
  saveCachedPubkey,
  type CachedPubkeyBinding,
} from "@/lib/nostr/nostr-pubkey-cache";
import { parseProfileContent, type NostrProfileData } from "@/lib/nostr/parse-profile-content";
import { verifyProfileAttestation } from "@/lib/nostr/profile-attestation";

/**
 * Forward skew for kind:0 `created_at` on read.
 * Far-future plants are the cheap eclipse form; NTP/mobile skew is usually
 * seconds–minutes. 1h leaves margin for wrong clocks without leaving a day-long
 * attack window. Past events are unbounded (profiles are naturally old).
 */
export const ATTESTED_PROFILE_CREATED_AT_SKEW_SECONDS = 3600;

/** Per-address coverage / subscribe limit — never shared across a page. */
export const KIND0_PER_ADDRESS_LIMIT = 20;

const DEFAULT_NOW_SEC = () => Math.floor(Date.now() / 1000);

export type AttestedProfileQueryPool = AppEventQueryPool;

export type ResolveAttestedProfileOptions = {
  pool?: AttestedProfileQueryPool;
  /** Test / clock injection — unix seconds. */
  nowSec?: number;
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

export type ResolvedAttestedProfile = {
  profile: NostrProfileData;
  pubkey: string;
  createdAt: number;
  eventId: string;
};

let serverPoolInstance: SimplePool | null = null;

/** @internal retained for server cold-start without browser pool */
function getServerPool(): AppEventQueryPool {
  if (!serverPoolInstance) {
    serverPoolInstance = new SimplePool();
  }
  return serverPoolInstance;
}

function resolvePool(options?: ResolveAttestedProfileOptions): AppEventQueryPool {
  if (options?.pool) return options.pool;
  try {
    return getDefaultNostrPool();
  } catch {
    return getServerPool();
  }
}

function toWalletAddress(address: Address | `0x${string}`): `0x${string}` {
  return address as `0x${string}`;
}

export function normalizeProfileAddress(address: string): string {
  return address.trim().toLowerCase();
}

/** True when `created_at` is not beyond `now + skew` (past always allowed). */
export function isCreatedAtWithinReadSkew(
  createdAt: number,
  nowSec: number = DEFAULT_NOW_SEC(),
  skewSeconds: number = ATTESTED_PROFILE_CREATED_AT_SKEW_SECONDS,
): boolean {
  return createdAt <= nowSec + skewSeconds;
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

/** Single-address NIP-39 `#i` filter — sole owner of identity-tag queries. */
export function attestedProfileFilterForAddress(address: Address | string): Filter {
  const tag = `ethereum:${normalizeProfileAddress(address)}`;
  return {
    kinds: [0],
    "#i": [tag],
    limit: KIND0_PER_ADDRESS_LIMIT,
  };
}

/** Author-keyed filter once pubkey is known (cannot be eclipsed by `#i` plants). */
export function attestedProfileFilterForAuthor(pubkey: string): Filter {
  return {
    kinds: [0],
    authors: [pubkey],
    limit: KIND0_PER_ADDRESS_LIMIT,
  };
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

function filterEventsBySkew(events: Event[], nowSec: number): Event[] {
  return events.filter((e) => isCreatedAtWithinReadSkew(e.created_at, nowSec));
}

type PickedVerified = {
  event: Event;
  profile: NostrProfileData;
};

async function verifyEventForAddress(
  event: Event,
  expectedAddress: string,
): Promise<PickedVerified | null> {
  const address = ethereumAddressFromEvent(event);
  if (!address || address !== expectedAddress) return null;

  const verified = await verifyProfileAttestation(
    { id: event.id, pubkey: event.pubkey, content: event.content },
    address as `0x${string}`,
  );
  if (!verified) return null;

  const parsed = parseProfileContent(event.content);
  return { event, profile: parsed ?? {} };
}

/**
 * Pin-aware pick among skew-filtered events.
 * - Prefer newest verifying event from the pinned pubkey.
 * - A verifying challenger with created_at > boundCreatedAt replaces the pin.
 * - Unverified challengers never displace the pin.
 */
async function pickWithPin(
  events: Event[],
  expectedAddress: string,
  pin: CachedPubkeyBinding | null,
  nowSec: number,
): Promise<{ picked: PickedVerified; nextPin: CachedPubkeyBinding } | null> {
  const skewed = filterEventsBySkew(events, nowSec);
  const sorted = [...skewed].sort((a, b) => b.created_at - a.created_at);

  let bestPinned: PickedVerified | null = null;
  let bestChallenger: PickedVerified | null = null;

  for (const event of sorted) {
    const verified = await verifyEventForAddress(event, expectedAddress);
    if (!verified) continue;

    if (pin && verified.event.pubkey === pin.pubkey) {
      if (!bestPinned) bestPinned = verified;
      continue;
    }

    if (pin) {
      if (verified.event.created_at > pin.boundCreatedAt) {
        if (!bestChallenger || verified.event.created_at > bestChallenger.event.created_at) {
          bestChallenger = verified;
        }
      }
      continue;
    }

    // No pin yet — first verifying (newest-first walk) wins.
    const nextPin: CachedPubkeyBinding = {
      pubkey: verified.event.pubkey,
      boundCreatedAt: verified.event.created_at,
    };
    return { picked: verified, nextPin };
  }

  if (bestChallenger) {
    const nextPin: CachedPubkeyBinding = {
      pubkey: bestChallenger.event.pubkey,
      boundCreatedAt: bestChallenger.event.created_at,
    };
    return { picked: bestChallenger, nextPin };
  }

  if (bestPinned) {
    return {
      picked: bestPinned,
      nextPin: {
        pubkey: bestPinned.event.pubkey,
        boundCreatedAt: Math.max(pin?.boundCreatedAt ?? 0, bestPinned.event.created_at),
      },
    };
  }

  return null;
}

async function coverageEvents(
  pool: AppEventQueryPool,
  filter: Filter,
): Promise<Event[]> {
  const coverage = await fetchRelayCoverage(pool, filter);
  if (coverage.status === "unanswered") return [];
  return coverage.events;
}

async function resolveAddressInternal(
  walletAddress: Address | `0x${string}`,
  options?: ResolveAttestedProfileOptions,
): Promise<ResolvedAttestedProfile | null> {
  const address = toWalletAddress(walletAddress);
  const expected = normalizeProfileAddress(address);
  const pool = resolvePool(options);
  const nowSec = options?.nowSec ?? DEFAULT_NOW_SEC();
  const pin = loadCachedPubkeyBinding(address);

  let events: Event[];
  if (pin?.pubkey) {
    events = await coverageEvents(pool, attestedProfileFilterForAuthor(pin.pubkey));
    // Author miss (key cached, no events yet) → discovery; otherwise no `#i`.
    if (events.length === 0) {
      events = await coverageEvents(pool, attestedProfileFilterForAddress(address));
    }
  } else {
    events = await coverageEvents(pool, attestedProfileFilterForAddress(address));
  }

  const result = await pickWithPin(events, expected, pin, nowSec);
  if (!result) return null;

  saveCachedPubkey(address, result.nextPin.pubkey, result.nextPin.boundCreatedAt);

  return {
    profile: result.picked.profile,
    pubkey: result.picked.event.pubkey,
    createdAt: result.picked.event.created_at,
    eventId: result.picked.event.id,
  };
}

/** Verify a subscription event; returns null when attestation fails or skew exceeded. */
export async function verifyIncomingProfileEvent(
  event: Pick<Event, "id" | "pubkey" | "content" | "created_at" | "tags">,
  nowSec: number = DEFAULT_NOW_SEC(),
): Promise<VerifiedProfileEntry | null> {
  try {
    if (!isCreatedAtWithinReadSkew(event.created_at, nowSec)) return null;

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

/**
 * After a live event verifies, update the pin per the challenge rule.
 * Unverified events must not call this.
 */
export function recordVerifiedBindingFromEntry(entry: VerifiedProfileEntry): void {
  const address = entry.address as `0x${string}`;
  const pin = loadCachedPubkeyBinding(address);
  if (!pin) {
    saveCachedPubkey(address, entry.pubkey, entry.createdAt);
    return;
  }
  if (entry.pubkey === pin.pubkey) {
    if (entry.createdAt > pin.boundCreatedAt) {
      saveCachedPubkey(address, entry.pubkey, entry.createdAt);
    }
    return;
  }
  if (entry.createdAt > pin.boundCreatedAt) {
    saveCachedPubkey(address, entry.pubkey, entry.createdAt);
  }
}

/** Newest attested kind:0 profile for a wallet address, or null when none verify. */
export async function resolveAttestedProfile(
  walletAddress: Address | `0x${string}`,
  options?: ResolveAttestedProfileOptions,
): Promise<NostrProfileData | null> {
  try {
    const resolved = await resolveAddressInternal(walletAddress, options);
    return resolved?.profile ?? null;
  } catch {
    return null;
  }
}

/** Batch variant — independent per-address coverage (no shared limit). */
export async function resolveAttestedProfiles(
  addresses: Address[],
  options?: ResolveAttestedProfileOptions,
): Promise<Map<string, NostrProfileData | null>> {
  const normalized = [...new Set(addresses.map((a) => normalizeProfileAddress(a)))];
  const result = new Map<string, NostrProfileData | null>();
  if (normalized.length === 0) return result;

  await Promise.all(
    normalized.map(async (addr) => {
      try {
        const resolved = await resolveAddressInternal(addr as `0x${string}`, options);
        result.set(addr, resolved?.profile ?? null);
      } catch {
        result.set(addr, null);
      }
    }),
  );

  return result;
}

/** Server-safe single-address resolver. */
export async function resolveAttestedProfileServer(
  address: `0x${string}`,
  options?: Omit<ResolveAttestedProfileOptions, "pool">,
): Promise<NostrProfileData | null> {
  return resolveAttestedProfile(address, options);
}

/** Batch variant of attestedPubkeyForAddress — one entry per requested address. */
export async function attestedPubkeysForAddresses(
  addresses: Address[],
  options?: ResolveAttestedProfileOptions,
): Promise<Map<string, string | null>> {
  const normalized = [...new Set(addresses.map((a) => normalizeProfileAddress(a)))];
  const result = new Map<string, string | null>();
  if (normalized.length === 0) return result;

  await Promise.all(
    normalized.map(async (addr) => {
      try {
        const resolved = await resolveAddressInternal(addr as `0x${string}`, options);
        result.set(addr, resolved?.pubkey ?? null);
      } catch {
        result.set(addr, null);
      }
    }),
  );

  return result;
}

/** Nostr pubkey from the newest verified kind:0 event for an address. */
export async function attestedPubkeyForAddress(
  address: `0x${string}`,
  options?: ResolveAttestedProfileOptions,
): Promise<string | null> {
  try {
    const resolved = await resolveAddressInternal(address, options);
    return resolved?.pubkey ?? null;
  } catch {
    return null;
  }
}

"use client";

import { hexToBytes } from "viem";
import { finalizeEvent, type Event } from "nostr-tools";

import { getNostrPool, nostrPubkeyFromPrivateKey } from "@/lib/nostr/nostr-client";
import {
  publishSignedEvent,
  type NostrPublishPool,
} from "@/lib/nostr/publish-event";
import { NOSTR_RELAYS } from "@/lib/nostr/relays";

export const FAVORITES_LIST_ID = "kargain-favorites";
export const PASSPORT_TAG_PREFIX = "kargain:passport:";

/** Tombstones older than this are pruned on read and before publish. */
export const LWW_TOMBSTONE_PRUNE_SECONDS = 90 * 24 * 60 * 60;

export type AppEventMergeStrategy = "lww-element-set" | "latest-per-author-per-d";

export type LwwAppEventPolicy = {
  kind: number;
  dTag: string;
  strategy: "lww-element-set";
};

/** Per-document kinds: `d` varies per subject; merge keeps newest per (author, d). */
export type LatestPerAuthorPerDPolicy = {
  kind: number;
  strategy: "latest-per-author-per-d";
};

export type AppEventPolicy = LwwAppEventPolicy | LatestPerAuthorPerDPolicy;

export const FAVORITES_POLICY: LwwAppEventPolicy = {
  kind: 30000,
  dTag: FAVORITES_LIST_ID,
  strategy: "lww-element-set",
};

/** Kind 31860 Commons reviews (lib/vincent-commons/review.ts) — d = claimHash. */
export const COMMONS_REVIEWS_POLICY: LatestPerAuthorPerDPolicy = {
  kind: 31860,
  strategy: "latest-per-author-per-d",
};

/** Kind 31861 Commons claim proposals (lib/nostr/commons-claims.ts) — d = claimHash. */
export const COMMONS_CLAIM_PROPOSALS_POLICY: LatestPerAuthorPerDPolicy = {
  kind: 31861,
  strategy: "latest-per-author-per-d",
};

/** Kind 31862 Commons epoch confirmations (lib/vincent-commons/confirmation.ts) — d = manifestHash. */
export const COMMONS_CONFIRMATIONS_POLICY: LatestPerAuthorPerDPolicy = {
  kind: 31862,
  strategy: "latest-per-author-per-d",
};

/**
 * LWW element-set content (kind 30000, d=`kargain-favorites`).
 *
 * ```json
 * {
 *   "v": 1,
 *   "items": { "<tokenId>": { "a": <unixSeconds> } },
 *   "removed": { "<tokenId>": { "r": <unixSeconds> } }
 * }
 * ```
 *
 * Merge rules across all relay events (never pick-latest-only):
 * - Per tokenId, compare max `a` vs max `r` across every parsed event.
 * - Element is present when max(a) >= max(r); equal timestamps resolve to add.
 * - Legacy tag-only events: each `["i","kargain:passport:<id>"]` is an add at `created_at`.
 * - Published events mirror legacy `i` tags for the current active set.
 */
export type LwwElementSetState = {
  items: Record<string, { a: number }>;
  removed: Record<string, { r: number }>;
};

export type AppEventQueryPool = {
  querySync: (
    relays: string[],
    filter: { kinds: number[]; authors: string[]; "#d": string[]; limit: number },
    opts: { maxWait: number },
  ) => Promise<Event[]>;
};

function emptyLwwState(): LwwElementSetState {
  return { items: {}, removed: {} };
}

function toPrivateKeyBytes(privateKey: string): Uint8Array {
  const hex = privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`;
  return hexToBytes(hex as `0x${string}`);
}

function parseTokenIdsFromLegacyTags(tags: string[][]): string[] {
  const ids: string[] = [];
  for (const tag of tags) {
    if (tag[0] !== "i" || !tag[1]?.startsWith(PASSPORT_TAG_PREFIX)) continue;
    const tokenId = tag[1].slice(PASSPORT_TAG_PREFIX.length);
    if (tokenId) ids.push(tokenId);
  }
  return ids;
}

function normalizeItemsRecord(raw: unknown): Record<string, { a: number }> {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, { a: number }> = {};
  for (const [tokenId, entry] of Object.entries(raw as Record<string, unknown>)) {
    if (!tokenId) continue;
    if (entry == null || typeof entry !== "object" || Array.isArray(entry)) continue;
    const a = (entry as Record<string, unknown>).a;
    const ts = typeof a === "number" ? a : Number(a);
    if (!Number.isFinite(ts) || ts < 0) continue;
    out[tokenId] = { a: Math.floor(ts) };
  }
  return out;
}

function normalizeRemovedRecord(raw: unknown): Record<string, { r: number }> {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, { r: number }> = {};
  for (const [tokenId, entry] of Object.entries(raw as Record<string, unknown>)) {
    if (!tokenId) continue;
    if (entry == null || typeof entry !== "object" || Array.isArray(entry)) continue;
    const r = (entry as Record<string, unknown>).r;
    const ts = typeof r === "number" ? r : Number(r);
    if (!Number.isFinite(ts) || ts < 0) continue;
    out[tokenId] = { r: Math.floor(ts) };
  }
  return out;
}

/** Parse one kind 30000 event into LWW ops (v1 JSON or legacy tags). */
export function parseLwwElementSetEvent(event: Event): LwwElementSetState {
  const state = emptyLwwState();

  if (event.content.trim()) {
    try {
      const parsed = JSON.parse(event.content) as Record<string, unknown>;
      if (parsed.v === 1) {
        const items = normalizeItemsRecord(parsed.items);
        const removed = normalizeRemovedRecord(parsed.removed);
        if (Object.keys(items).length > 0 || Object.keys(removed).length > 0) {
          return { items, removed };
        }
      }
    } catch {
      // fall through to legacy tag parse
    }
  }

  const legacyIds = parseTokenIdsFromLegacyTags(event.tags);
  for (const tokenId of legacyIds) {
    state.items[tokenId] = { a: event.created_at };
  }
  return state;
}

function mergeMaxAdd(
  target: Record<string, { a: number }>,
  source: Record<string, { a: number }>,
): void {
  for (const [tokenId, entry] of Object.entries(source)) {
    const prev = target[tokenId]?.a ?? -1;
    if (entry.a > prev) {
      target[tokenId] = { a: entry.a };
    }
  }
}

function mergeMaxRemove(
  target: Record<string, { r: number }>,
  source: Record<string, { r: number }>,
): void {
  for (const [tokenId, entry] of Object.entries(source)) {
    const prev = target[tokenId]?.r ?? -1;
    if (entry.r > prev) {
      target[tokenId] = { r: entry.r };
    }
  }
}

/**
 * `latest-per-author-per-d` merge: newest event per (author, d) pair.
 * NIP-01 replaceable tie-break — equal `created_at` keeps the lower id.
 */
export function mergeLatestPerAuthorPerD(events: Event[]): Event[] {
  const byKey = new Map<string, Event>();
  for (const event of events) {
    const dTag = event.tags.find((tag) => tag[0] === "d")?.[1] ?? "";
    const key = `${event.pubkey}\u0000${dTag}`;
    const prev = byKey.get(key);
    if (
      !prev ||
      event.created_at > prev.created_at ||
      (event.created_at === prev.created_at && event.id < prev.id)
    ) {
      byKey.set(key, event);
    }
  }
  return [...byKey.values()];
}

/** Merge all events; never pick-latest-only. */
export function mergeLwwElementSetEvents(events: Event[]): LwwElementSetState {
  const merged = emptyLwwState();
  for (const event of events) {
    const parsed = parseLwwElementSetEvent(event);
    mergeMaxAdd(merged.items, parsed.items);
    mergeMaxRemove(merged.removed, parsed.removed);
  }
  return merged;
}

export function applyLwwAdd(
  state: LwwElementSetState,
  tokenId: string,
  ts: number,
): LwwElementSetState {
  if (!tokenId) return state;
  const next: LwwElementSetState = {
    items: { ...state.items, [tokenId]: { a: ts } },
    removed: { ...state.removed },
  };
  delete next.removed[tokenId];
  return next;
}

export function applyLwwRemove(
  state: LwwElementSetState,
  tokenId: string,
  ts: number,
): LwwElementSetState {
  if (!tokenId) return state;
  const next: LwwElementSetState = {
    items: { ...state.items },
    removed: { ...state.removed, [tokenId]: { r: ts } },
  };
  delete next.items[tokenId];
  return next;
}

export function pruneLwwTombstones(
  state: LwwElementSetState,
  nowSeconds: number,
): LwwElementSetState {
  const cutoff = nowSeconds - LWW_TOMBSTONE_PRUNE_SECONDS;
  const removed: Record<string, { r: number }> = {};
  for (const [tokenId, entry] of Object.entries(state.removed)) {
    if (entry.r >= cutoff) {
      removed[tokenId] = entry;
    }
  }
  return { items: { ...state.items }, removed };
}

function isTokenActive(state: LwwElementSetState, tokenId: string): boolean {
  const addTs = state.items[tokenId]?.a ?? -1;
  const removeTs = state.removed[tokenId]?.r ?? -1;
  return addTs >= removeTs;
}

/** Active token IDs: present when newest op is add; tie resolves to add. */
export function lwwActiveTokenIds(state: LwwElementSetState): string[] {
  const ids = new Set<string>([
    ...Object.keys(state.items),
    ...Object.keys(state.removed),
  ]);
  const active: Array<{ tokenId: string; addTs: number }> = [];
  for (const tokenId of ids) {
    if (!isTokenActive(state, tokenId)) continue;
    active.push({ tokenId, addTs: state.items[tokenId]?.a ?? 0 });
  }
  active.sort((a, b) => {
    if (a.addTs !== b.addTs) return a.addTs - b.addTs;
    return a.tokenId.localeCompare(b.tokenId);
  });
  return active.map((row) => row.tokenId);
}

export function serializeLwwContent(state: LwwElementSetState): string {
  return JSON.stringify({ v: 1, items: state.items, removed: state.removed });
}

export function buildLwwLegacyTags(tokenIds: string[], dTag: string): string[][] {
  const tags: string[][] = [["d", dTag]];
  for (const tokenId of tokenIds) {
    tags.push(["i", `${PASSPORT_TAG_PREFIX}${tokenId}`]);
  }
  return tags;
}

export async function fetchAppEvents(
  pool: AppEventQueryPool,
  pubkey: string,
  policy: LwwAppEventPolicy,
): Promise<Event[]> {
  if (!pubkey.trim()) return [];
  return pool.querySync(
    [...NOSTR_RELAYS],
    { kinds: [policy.kind], authors: [pubkey], "#d": [policy.dTag], limit: 5 },
    { maxWait: 4500 },
  );
}

export async function publishLwwElementSet(
  pool: NostrPublishPool,
  privateKey: string,
  policy: LwwAppEventPolicy,
  state: LwwElementSetState,
): Promise<boolean> {
  if (!privateKey.trim()) return false;

  const activeIds = lwwActiveTokenIds(state);
  const content = serializeLwwContent(state);
  const tags = buildLwwLegacyTags(activeIds, policy.dTag);

  const unsigned = {
    kind: policy.kind,
    created_at: Math.floor(Date.now() / 1000),
    content,
    tags,
  };
  const signed = finalizeEvent(unsigned, toPrivateKeyBytes(privateKey));
  const result = await publishSignedEvent(pool, signed);
  return result.ok;
}

const pubkeyWriteChains = new Map<string, Promise<unknown>>();

/** Serialize in-flight writes per pubkey (same-tab rapid toggles cannot interleave). */
export function runSerializedPubkeyWrite<T>(
  pubkey: string,
  fn: () => Promise<T>,
): Promise<T> {
  const normalized = pubkey.trim().toLowerCase();
  const prev = pubkeyWriteChains.get(normalized) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  pubkeyWriteChains.set(normalized, next);
  void next.finally(() => {
    if (pubkeyWriteChains.get(normalized) === next) {
      pubkeyWriteChains.delete(normalized);
    }
  });
  return next;
}

export async function mergeReadLwwState(
  pool: AppEventQueryPool,
  pubkey: string,
  policy: LwwAppEventPolicy,
): Promise<LwwElementSetState> {
  const events = await fetchAppEvents(pool, pubkey, policy);
  const merged = mergeLwwElementSetEvents(events);
  const now = Math.floor(Date.now() / 1000);
  return pruneLwwTombstones(merged, now);
}

export function syncLwwStateToTokenIds(
  state: LwwElementSetState,
  targetIds: string[],
  nowSeconds: number,
): LwwElementSetState {
  const uniqueTarget = [...new Set(targetIds.filter((id) => id.length > 0))];
  const targetSet = new Set(uniqueTarget);
  let next = state;

  for (const tokenId of uniqueTarget) {
    if (!isTokenActive(next, tokenId)) {
      next = applyLwwAdd(next, tokenId, nowSeconds);
    }
  }

  for (const tokenId of lwwActiveTokenIds(next)) {
    if (!targetSet.has(tokenId)) {
      next = applyLwwRemove(next, tokenId, nowSeconds);
    }
  }

  return pruneLwwTombstones(next, nowSeconds);
}

export function getDefaultNostrPool(): AppEventQueryPool & NostrPublishPool {
  return testPoolOverride ?? getNostrPool();
}

export function pubkeyFromPrivateKey(privateKey: string): string {
  return nostrPubkeyFromPrivateKey(privateKey);
}

let testPoolOverride: (AppEventQueryPool & NostrPublishPool) | null = null;

/** Test-only pool injection for favorites integration tests. */
export function setAppEventStorePoolForTest(
  pool: (AppEventQueryPool & NostrPublishPool) | null,
): void {
  testPoolOverride = pool;
}

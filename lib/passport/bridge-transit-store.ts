/**
 * In-memory bridge transit map + session persistence.
 * React consumers use useSyncExternalStore via subscribe/getSnapshot.
 */

import {
  clearBridgeTransitRecord,
  getBrowserTransitStorage,
  isBridgeTransitActivePhase,
  readBridgeTransitRecord,
  writeBridgeTransitRecord,
  type BridgeTransitRecord,
  type TransitStorage,
} from "@/lib/passport/bridge-transit";

type Listener = () => void;

function mapKey(address: string, tokenId: string): string {
  return `${address.toLowerCase()}:${tokenId}`;
}

let memory = new Map<string, BridgeTransitRecord>();
const listeners = new Set<Listener>();
let storage: TransitStorage | null = null;
/** Bumps on every mutation so useSyncExternalStore sees a new snapshot. */
let version = 0;

function emit(): void {
  version += 1;
  for (const listener of listeners) listener();
}

function ensureStorage(): TransitStorage | null {
  if (storage != null) return storage;
  storage = getBrowserTransitStorage();
  return storage;
}

/** Test / SSR: inject or clear storage backend. */
export function setBridgeTransitStorageForTests(
  next: TransitStorage | null,
): void {
  storage = next;
}

export function resetBridgeTransitStoreForTests(): void {
  memory = new Map();
  storage = null;
  version = 0;
  emit();
}

export function subscribeBridgeTransit(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Version snapshot for useSyncExternalStore (not the map itself). */
export function getBridgeTransitSnapshot(): number {
  return version;
}

export function getBridgeTransit(
  address: string | undefined | null,
  tokenId: string,
): BridgeTransitRecord | null {
  if (!address) return null;
  return memory.get(mapKey(address, tokenId)) ?? null;
}

/** All active transits for a wallet (profile overlay). */
export function listBridgeTransitsForAddress(
  address: string | undefined | null,
): BridgeTransitRecord[] {
  if (!address) return [];
  const prefix = `${address.toLowerCase()}:`;
  const out: BridgeTransitRecord[] = [];
  for (const [key, record] of memory) {
    if (key.startsWith(prefix) && isBridgeTransitActivePhase(record.phase)) {
      out.push(record);
    }
  }
  return out;
}

export function upsertBridgeTransit(
  address: string,
  record: BridgeTransitRecord,
): void {
  memory.set(mapKey(address, record.tokenId), record);
  const store = ensureStorage();
  if (store) writeBridgeTransitRecord(address, record, store);
  emit();
}

export function removeBridgeTransit(
  address: string,
  tokenId: string,
): void {
  memory.delete(mapKey(address, tokenId));
  const store = ensureStorage();
  if (store) clearBridgeTransitRecord(address, tokenId, store);
  emit();
}

/**
 * Hydrate one token from session into memory (mount recovery).
 * Does not reconcile — caller must reconcile with chain facts.
 */
export function hydrateBridgeTransitFromSession(
  address: string,
  tokenId: string,
): BridgeTransitRecord | null {
  const existing = memory.get(mapKey(address, tokenId));
  if (existing) return existing;
  const store = ensureStorage();
  if (!store) return null;
  const record = readBridgeTransitRecord(address, tokenId, store);
  if (!record) return null;
  memory.set(mapKey(address, tokenId), record);
  emit();
  return record;
}

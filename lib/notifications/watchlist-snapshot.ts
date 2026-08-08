import type { WatchlistSnapshot } from "@/lib/notifications/types";

const DB_NAME = "kargain_notifications";
const DB_VERSION = 1;
const IDB_STORE = "watchlist_snapshots_v1";

export type WatchlistSnapshotChangeType =
  | "status_changed"
  | "listing_deactivated"
  | "price_changed"
  | "dispute_opened";

export type WatchlistSnapshotDiff = {
  tokenId: string;
  changeType: WatchlistSnapshotChangeType;
  old: WatchlistSnapshot;
  new: WatchlistSnapshot;
};

function requireBrowser(): boolean {
  return typeof window !== "undefined" && Boolean(window.indexedDB);
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = window.indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE, { keyPath: "tokenId" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB open failed."));
  });
}

export async function loadSnapshots(): Promise<WatchlistSnapshot[]> {
  try {
    if (!requireBrowser()) return [];
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readonly");
      const store = tx.objectStore(IDB_STORE);
      const req = store.getAll();
      req.onsuccess = () => resolve((req.result as WatchlistSnapshot[]) ?? []);
      req.onerror = () => reject(req.error ?? new Error("IndexedDB read failed."));
    });
  } catch (err) {
    console.error("loadSnapshots failed", err);
    return [];
  }
}

export async function saveSnapshots(snapshots: WatchlistSnapshot[]): Promise<void> {
  try {
    if (!requireBrowser()) return;
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readwrite");
      const store = tx.objectStore(IDB_STORE);
      store.clear();
      for (const snapshot of snapshots) {
        store.put(snapshot);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("IndexedDB write failed."));
    });
  } catch (err) {
    console.error("saveSnapshots failed", err);
  }
}

export function diffSnapshots(
  previous: WatchlistSnapshot[],
  current: WatchlistSnapshot[],
): WatchlistSnapshotDiff[] {
  const normalize = (s: WatchlistSnapshot): WatchlistSnapshot => ({
    ...s,
    price: s.price ?? s.fiatPrice1e8 ?? "0",
    denominationKind:
      s.denominationKind === 0 || s.denominationKind === 1
        ? s.denominationKind
        : 1,
  });
  const previousByToken = new Map(
    previous.map((s) => [s.tokenId, normalize(s)]),
  );
  const diffs: WatchlistSnapshotDiff[] = [];

  for (const newSnapRaw of current) {
    const newSnap = normalize(newSnapRaw);
    const oldSnap = previousByToken.get(newSnap.tokenId);
    if (!oldSnap) continue;

    if (oldSnap.status !== newSnap.status) {
      diffs.push({
        tokenId: newSnap.tokenId,
        changeType: "status_changed",
        old: oldSnap,
        new: newSnap,
      });
    }

    if (oldSnap.active && !newSnap.active) {
      diffs.push({
        tokenId: newSnap.tokenId,
        changeType: "listing_deactivated",
        old: oldSnap,
        new: newSnap,
      });
    }

    if (
      (oldSnap.price !== newSnap.price ||
        oldSnap.denominationKind !== newSnap.denominationKind) &&
      newSnap.active
    ) {
      diffs.push({
        tokenId: newSnap.tokenId,
        changeType: "price_changed",
        old: oldSnap,
        new: newSnap,
      });
    }

    if (newSnap.status === "DISPUTED" && oldSnap.status !== "DISPUTED") {
      diffs.push({
        tokenId: newSnap.tokenId,
        changeType: "dispute_opened",
        old: oldSnap,
        new: newSnap,
      });
    }
  }

  return diffs;
}

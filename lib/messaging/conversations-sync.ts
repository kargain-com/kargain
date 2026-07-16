export const CONVERSATIONS_SYNC_DEBOUNCE_MS = 2_000;
export const CONVERSATIONS_SYNC_INTERVAL_MS = 60_000;

/** Skip sync when the previous run finished within minIntervalMs. */
export function shouldSyncConversations(
  lastSyncAtMs: number | null,
  nowMs: number,
  minIntervalMs = CONVERSATIONS_SYNC_DEBOUNCE_MS,
): boolean {
  if (lastSyncAtMs === null) return true;
  return nowMs - lastSyncAtMs >= minIntervalMs;
}

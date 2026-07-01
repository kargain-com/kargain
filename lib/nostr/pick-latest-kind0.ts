import type { Event } from "nostr-tools";

/** Pick the newest kind:0 event from a relay batch. */
export function pickLatestKind0Event(events: Event[]): Event | null {
  if (events.length === 0) return null;
  const sorted = [...events].sort((a, b) => b.created_at - a.created_at);
  return sorted[0] ?? null;
}

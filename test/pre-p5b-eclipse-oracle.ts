import type { Event } from "nostr-tools";

/**
 * Oracle of the pre-P5b shared-budget pick (newest-first, take first `limit`).
 * Not production code — used only to illustrate that the old shape would drop
 * a genuine event under an eclipse plant. Cannot be falsified against live
 * deleted code; name it an oracle, not a regression harness.
 */
export function preP5bEclipseOraclePick(events: Event[], limit: number): Event[] {
  return [...events].sort((a, b) => b.created_at - a.created_at).slice(0, limit);
}

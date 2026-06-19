/** Stable dedupe ID for Ponder-sourced notifications */
export function ponderNotifId(type: string, tokenId: string, timestamp: string): string {
  return `ponder:${type}:${tokenId}:${timestamp}`;
}

/** Stable dedupe ID for Nostr-sourced notifications */
export function nostrNotifId(kind: number, eventId: string): string {
  return `nostr:${kind}:${eventId}`;
}

/** Group key for a passport */
export function passportGroupKey(tokenId: string): string {
  return `passport:${tokenId}`;
}

/** Group key for a Nostr thread */
export function nostrGroupKey(rootEventId: string): string {
  return `nostr:thread:${rootEventId}`;
}

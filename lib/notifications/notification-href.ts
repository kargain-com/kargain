/** Deep link to passport discussion; optional Nostr event id scrolls to a comment. */
export function marketplaceCommentHref(tokenId: string, eventId?: string): string {
  const base = `/marketplace/${encodeURIComponent(tokenId)}`;
  if (eventId?.trim()) {
    return `${base}?e=${encodeURIComponent(eventId.trim())}#passport-comments`;
  }
  return `${base}#passport-comments`;
}

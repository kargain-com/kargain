/** Deep link to passport discussion; optional Nostr event id scrolls to a comment. */
export function marketplaceCommentHref(tokenId: string, eventId?: string): string {
  const base = `/marketplace/${encodeURIComponent(tokenId)}`;
  if (!eventId?.trim()) return base;
  const params = new URLSearchParams();
  params.set("e", eventId.trim());
  return `${base}?${params.toString()}`;
}

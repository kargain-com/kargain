/** Deep link to passport discussion; optional Nostr event id scrolls to a comment. */
export function marketplaceCommentHref(tokenId: string, eventId?: string): string {
  const base = `/marketplace/${encodeURIComponent(tokenId)}`;
  const params = new URLSearchParams();
  params.set("panel", "comments");
  if (eventId?.trim()) {
    params.set("e", eventId.trim());
  }
  const query = params.toString();
  return query ? `${base}?${query}` : base;
}

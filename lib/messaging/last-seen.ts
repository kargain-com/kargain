export function lastSeenKey(conversationId: string): string {
  return `xmtp:lastseen:${conversationId}`;
}

export function getLastSeen(conversationId: string): Date | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(lastSeenKey(conversationId));
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function setLastSeen(conversationId: string, at: Date = new Date()): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(lastSeenKey(conversationId), at.toISOString());
  window.dispatchEvent(new CustomEvent("xmtp:lastseen-updated", { detail: { conversationId } }));
}

"use client";

import { useNostrKey } from "@/hooks/use-nostr-key";

/** Mounts Nostr key restore at app root (v1 blob silent load; v2 on first action). */
export function NostrKeyInitializer() {
  useNostrKey();
  return null;
}

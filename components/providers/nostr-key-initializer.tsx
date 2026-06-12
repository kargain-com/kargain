"use client";

import { useEffect } from "react";

import { useNostrKey } from "@/hooks/use-nostr-key";

/**
 * Pre-warms deterministic Nostr identity as soon as wallet auth is ready.
 * This keeps first comment interaction fast and avoids surprise delays.
 */
export function NostrKeyInitializer() {
  const { status } = useNostrKey();

  useEffect(() => {
    void status;
  }, [status]);

  return null;
}

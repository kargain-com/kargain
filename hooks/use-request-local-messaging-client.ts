"use client";

import { useEffect } from "react";

import { useMessagingSession } from "@/hooks/use-messaging-session";

/**
 * Raise client demand while a messaging surface that needs a local XMTP client is mounted.
 * Probe/build run only when demand &gt; 0.
 */
export function useRequestLocalMessagingClient(active = true): void {
  const { session } = useMessagingSession();

  useEffect(() => {
    if (!active || !session) return;
    session.requestLocalClient();
    return () => {
      session.releaseLocalClient();
    };
  }, [session, active]);
}

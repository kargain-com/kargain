"use client";

import { useEffect, useState } from "react";
import type { Address } from "viem";

import { useNostrProfile } from "@/hooks/use-nostr-profile";
import {
  peerReachabilityMessage,
  resolvePeerReachability,
  type PeerReachabilityReason,
} from "@/lib/messaging/can-message-peer";

/** Peer reachability via commercial-union account-kind probe (no hub default). */
export function usePeerMessagingReachability(peerAddress: Address | undefined): {
  reachable: boolean;
  reason: PeerReachabilityReason;
  message: string | null;
  isLoading: boolean;
} {
  const { profile, loading: profileLoading } = useNostrProfile(peerAddress);
  const [reason, setReason] = useState<PeerReachabilityReason>(null);
  const [reachable, setReachable] = useState(false);
  const [isChecking, setIsChecking] = useState(false);

  useEffect(() => {
    if (!peerAddress) {
      setReachable(false);
      setReason(null);
      setIsChecking(false);
      return;
    }

    let cancelled = false;
    setIsChecking(true);

    void (async () => {
      try {
        const result = await resolvePeerReachability(peerAddress, profile);
        if (cancelled) return;
        setReachable(result.reachable);
        setReason(result.reason);
      } catch {
        if (cancelled) return;
        setReachable(false);
        setReason("protocol");
      } finally {
        if (!cancelled) setIsChecking(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [peerAddress, profile]);

  return {
    reachable,
    reason,
    message: peerReachabilityMessage(reason),
    isLoading: profileLoading || isChecking,
  };
}

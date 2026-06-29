"use client";

import { useEffect, useState } from "react";
import type { Address } from "viem";

import { useNostrProfile } from "@/hooks/use-nostr-profile";
import {
  peerReachabilityMessage,
  resolvePeerReachability,
  type PeerReachabilityReason,
} from "@/lib/xmtp/can-message-peer";
import { DEFAULT_CHAIN_ID } from "@/lib/web3/supported-chains";

export function usePeerMessagingReachability(
  peerAddress: Address | undefined,
  chainId: number = DEFAULT_CHAIN_ID,
): {
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
        const result = await resolvePeerReachability(peerAddress, profile, chainId);
        if (cancelled) return;
        setReachable(result.reachable);
        setReason(result.reason);
      } catch {
        if (cancelled) return;
        setReachable(false);
        setReason("not_registered");
      } finally {
        if (!cancelled) setIsChecking(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [chainId, peerAddress, profile]);

  return {
    reachable,
    reason,
    message: peerReachabilityMessage(reason),
    isLoading: profileLoading || isChecking,
  };
}

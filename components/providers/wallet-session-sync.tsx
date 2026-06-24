"use client";

import { useEffect, useRef } from "react";
import { useAccount, useChainId } from "wagmi";

import { clearSiweSession } from "@/lib/auth/clear-siwe-session";

/**
 * Clears stale SIWE cookies when the connected wallet address or chain changes.
 * Does not disconnect wagmi or delete Nostr keys in local storage.
 */
export function WalletSessionSync() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const previousRef = useRef<{ address: string; chainId: number } | null>(null);

  useEffect(() => {
    if (!isConnected || !address) {
      previousRef.current = null;
      return;
    }

    const normalized = address.toLowerCase();
    const previous = previousRef.current;

    if (
      previous &&
      (previous.address !== normalized || previous.chainId !== chainId)
    ) {
      void clearSiweSession();
    }

    previousRef.current = { address: normalized, chainId };
  }, [address, chainId, isConnected]);

  return null;
}

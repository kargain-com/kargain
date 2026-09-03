"use client";

import { useEffect, useRef } from "react";

import {
  requireEvmSession,
  useActiveAccount,
} from "@/hooks/use-active-account";
import { clearSiweSession } from "@/lib/auth/clear-siwe-session";

/**
 * Clears stale SIWE cookies when the connected EVM wallet address or chain changes.
 * SVM sessions refuse via {@link requireEvmSession} (`wrong_vm`) — SIWE is EVM-only.
 * Does not disconnect wallets or delete Nostr keys in local storage.
 */
export function WalletSessionSync() {
  const { account } = useActiveAccount();
  const evm = requireEvmSession(account);
  const previousRef = useRef<{ address: string; chainId: number } | null>(null);

  useEffect(() => {
    if (!evm.ok) {
      previousRef.current = null;
      return;
    }

    const normalized = evm.address.toLowerCase();
    const previous = previousRef.current;

    if (
      previous &&
      (previous.address !== normalized || previous.chainId !== evm.chainId)
    ) {
      void clearSiweSession();
    }

    previousRef.current = { address: normalized, chainId: evm.chainId };
  }, [evm]);

  return null;
}

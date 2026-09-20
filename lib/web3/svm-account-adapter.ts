"use client";

/**
 * SVM account adapter — Wallet Standard session → ActiveAccount snapshot.
 * Kit validates addresses; web3.js never enters this module.
 * Discovery subscription lives in {@link ActiveAccountProvider} (one per app).
 *
 * Returns the session-stored ActiveAccountSvm reference — never allocates an
 * account object during render.
 *
 * Sign-and-send port: re-exports {@link createSvmSignAndSendPort} from the
 * session-adjacent owner (Wallet Standard feature bind).
 */

import { useCallback, useState } from "react";

import type { ActiveAccountSvm } from "@/lib/web3/active-account";
import { useSvmAccountSession } from "@/lib/web3/svm-account-session";
import type { Wallet } from "@wallet-standard/base";

export {
  createSvmSignAndSendPort,
  type CreateSvmSignAndSendPortCause,
  type CreateSvmSignAndSendPortResult,
} from "@/lib/web3/svm-sign-and-send-port";

export type SvmAccountAdapterSnapshot = {
  connected: ActiveAccountSvm | null;
  /** Live Wallet Standard handle while connected — Irys provider door. */
  wallet: Wallet | null;
  isConnectPending: boolean;
  connectError: Error | null;
  connect: (walletName: string) => Promise<void>;
  disconnect: () => Promise<void>;
  clear: () => void;
};

export function useSvmAccountAdapter(): SvmAccountAdapterSnapshot {
  const { session, connect: sessionConnect, disconnect, clear } =
    useSvmAccountSession();
  const [isConnectPending, setIsConnectPending] = useState(false);
  const [connectError, setConnectError] = useState<Error | null>(null);

  const connect = useCallback(
    async (walletName: string) => {
      setIsConnectPending(true);
      setConnectError(null);
      try {
        await sessionConnect(walletName);
      } catch (err) {
        const error =
          err instanceof Error ? err : new Error(String(err ?? "connect failed"));
        setConnectError(error);
        throw error;
      } finally {
        setIsConnectPending(false);
      }
    },
    [sessionConnect],
  );

  return {
    connected: session?.account ?? null,
    wallet: session?.wallet ?? null,
    isConnectPending,
    connectError,
    connect,
    disconnect,
    clear,
  };
}

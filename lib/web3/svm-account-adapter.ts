"use client";

/**
 * SVM account adapter — Wallet Standard session + discovery list.
 * Kit validates addresses; web3.js never enters this module.
 */

import { useCallback, useEffect, useState } from "react";

import type { ActiveAccountSvm } from "@/lib/web3/active-account";
import { useSvmAccountSession } from "@/lib/web3/svm-account-session";
import {
  listDiscoveredSvmWallets,
  subscribeSvmWalletDiscovery,
  type SvmDiscoveredWallet,
} from "@/lib/web3/svm-wallet-discovery";

export type SvmAccountAdapterSnapshot = {
  connected: ActiveAccountSvm | null;
  wallets: readonly SvmDiscoveredWallet[];
  isConnectPending: boolean;
  connectError: Error | null;
  connect: (walletName: string) => Promise<void>;
  disconnect: () => Promise<void>;
  clear: () => void;
};

export function useSvmAccountAdapter(): SvmAccountAdapterSnapshot {
  const { session, connect: sessionConnect, disconnect, clear } =
    useSvmAccountSession();
  const [wallets, setWallets] = useState<readonly SvmDiscoveredWallet[]>([]);
  const [isConnectPending, setIsConnectPending] = useState(false);
  const [connectError, setConnectError] = useState<Error | null>(null);

  useEffect(() => {
    const refresh = () => {
      setWallets(listDiscoveredSvmWallets());
    };
    refresh();
    return subscribeSvmWalletDiscovery(refresh);
  }, []);

  const connected: ActiveAccountSvm | null = session
    ? {
        status: "connected",
        vm: "svm",
        address: session.address,
      }
    : null;

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
    connected,
    wallets,
    isConnectPending,
    connectError,
    connect,
    disconnect,
    clear,
  };
}

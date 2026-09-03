"use client";

/**
 * In-memory SVM wallet session — one connected Solana account at a time.
 * Cleared on EVM connect (mutual exclusion with the EVM adapter).
 */

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { address as assertSolanaAddress } from "@solana/kit";
import {
  StandardConnect,
  StandardDisconnect,
  type StandardConnectFeature,
  type StandardDisconnectFeature,
} from "@wallet-standard/features";
import type { Wallet } from "@wallet-standard/base";

import {
  findDiscoveredSvmWallet,
  type SvmDiscoveredWallet,
} from "@/lib/web3/svm-wallet-discovery";

export type SvmSessionState = {
  address: string;
  walletName: string;
  wallet: Wallet;
} | null;

type SvmAccountSessionValue = {
  session: SvmSessionState;
  connect: (walletName: string) => Promise<void>;
  disconnect: () => Promise<void>;
  clear: () => void;
};

const SvmAccountSessionContext = createContext<SvmAccountSessionValue | null>(
  null,
);

function connectFeature(
  wallet: Wallet,
): StandardConnectFeature[typeof StandardConnect] {
  const feature = wallet.features[StandardConnect] as
    | StandardConnectFeature[typeof StandardConnect]
    | undefined;
  if (feature == null || typeof feature.connect !== "function") {
    throw new Error(`Wallet ${wallet.name} does not support standard:connect`);
  }
  return feature;
}

function disconnectFeature(
  wallet: Wallet,
): StandardDisconnectFeature[typeof StandardDisconnect] | undefined {
  const feature = wallet.features[StandardDisconnect] as
    | StandardDisconnectFeature[typeof StandardDisconnect]
    | undefined;
  if (feature == null || typeof feature.disconnect !== "function") {
    return undefined;
  }
  return feature;
}

export function SvmAccountSessionProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [session, setSession] = useState<SvmSessionState>(null);

  const clear = useCallback(() => {
    setSession(null);
  }, []);

  const disconnect = useCallback(async () => {
    const current = session;
    setSession(null);
    if (!current) return;
    const feature = disconnectFeature(current.wallet);
    if (feature) {
      try {
        await feature.disconnect();
      } catch {
        /* wallet cleanup is best-effort */
      }
    }
  }, [session]);

  const connect = useCallback(async (walletName: string) => {
    const discovered: SvmDiscoveredWallet | undefined =
      findDiscoveredSvmWallet(walletName);
    if (!discovered) {
      throw new Error(`Solana wallet not found: ${walletName}`);
    }
    const { wallet } = discovered;
    const feature = connectFeature(wallet);
    const { accounts } = await feature.connect();
    const account = accounts[0] ?? wallet.accounts[0];
    if (!account) {
      throw new Error(`Solana wallet ${wallet.name} returned no accounts`);
    }
    const canonical = assertSolanaAddress(account.address);
    setSession({
      address: canonical,
      walletName: wallet.name,
      wallet,
    });
  }, []);

  const value = useMemo(
    () => ({ session, connect, disconnect, clear }),
    [session, connect, disconnect, clear],
  );

  return (
    <SvmAccountSessionContext.Provider value={value}>
      {children}
    </SvmAccountSessionContext.Provider>
  );
}

export function useSvmAccountSession(): SvmAccountSessionValue {
  const ctx = useContext(SvmAccountSessionContext);
  if (!ctx) {
    throw new Error(
      "useSvmAccountSession must be used within SvmAccountSessionProvider",
    );
  }
  return ctx;
}

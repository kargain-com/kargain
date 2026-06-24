"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { useAccount, useWalletClient } from "wagmi";

import { createXmtpClient } from "@/lib/xmtp/client";
import type { XmtpClient } from "@/lib/xmtp/helpers";

type XmtpClientStore = {
  client: XmtpClient | null;
  isInitializing: boolean;
  error: string | null;
  walletKey: string | null;
};

let store: XmtpClientStore = {
  client: null,
  isInitializing: false,
  error: null,
  walletKey: null,
};

const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => listener());
}

function setStore(partial: Partial<XmtpClientStore>) {
  store = { ...store, ...partial };
  emit();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return store;
}

export function getCachedXmtpClient(): XmtpClient | null {
  return store.client;
}

export function useXmtpClient(): {
  client: XmtpClient | null;
  isInitializing: boolean;
  error: string | null;
  initialize: () => Promise<void>;
} {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const { address, isConnected } = useAccount();
  const { data: walletClient } = useWalletClient();

  const walletKey = address?.toLowerCase() ?? null;
  const client =
    isConnected && walletKey && snapshot.walletKey === walletKey ? snapshot.client : null;
  const isInitializing = snapshot.isInitializing;
  const error = snapshot.error;

  useEffect(() => {
    if (!isConnected) {
      resetXmtpClientOnDisconnect(false);
    }
  }, [isConnected]);

  useEffect(() => {
    if (!isConnected || !address) return;
    const key = address.toLowerCase();
    if (store.client && store.walletKey && store.walletKey !== key) {
      store.client.close();
      setStore({
        client: null,
        isInitializing: false,
        error: null,
        walletKey: null,
      });
    }
  }, [address, isConnected]);

  const initialize = useCallback(async () => {
    if (!isConnected || !address || !walletClient) {
      setStore({ client: null, error: null, walletKey: null });
      return;
    }

    const key = address.toLowerCase();
    if (store.client && store.walletKey === key) return;

    if (store.isInitializing) return;

    setStore({ isInitializing: true, error: null });

    try {
      if (store.client && store.walletKey !== key) {
        store.client.close();
      }

      const created = await createXmtpClient(walletClient, address);
      setStore({
        client: created,
        isInitializing: false,
        error: null,
        walletKey: key,
      });
    } catch (e) {
      setStore({
        client: null,
        isInitializing: false,
        error: e instanceof Error ? e.message : "Failed to initialize XMTP.",
        walletKey: null,
      });
    }
  }, [address, isConnected, walletClient]);

  return { client, isInitializing, error, initialize };
}

export function resetXmtpClientOnDisconnect(isConnected: boolean) {
  if (isConnected) return;
  if (store.client) {
    store.client.close();
  }
  setStore({
    client: null,
    isInitializing: false,
    error: null,
    walletKey: null,
  });
}

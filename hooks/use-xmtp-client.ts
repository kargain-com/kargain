"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { useAccount, useWalletClient } from "wagmi";

import { createXmtpClient } from "@/lib/xmtp/client";
import type { XmtpClient } from "@/lib/xmtp/helpers";
import {
  messagingWalletError,
  readAccountKindFromProvider,
} from "@/lib/web3/wallet-account";

type XmtpClientStore = {
  client: XmtpClient | null;
  isInitializing: boolean;
  error: string | null;
  walletKey: string | null;
};

const XMTP_OPT_IN_PREFIX = "xmtp:opted-in:";

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

function optInKey(address: string): string {
  return `${XMTP_OPT_IN_PREFIX}${address.toLowerCase()}`;
}

function hasOptedIn(address: string): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(optInKey(address)) === "1";
}

function setOptedIn(address: string): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(optInKey(address), "1");
}

export function getCachedXmtpClient(): XmtpClient | null {
  return store.client;
}

function waitForInitialization(): Promise<void> {
  if (!store.isInitializing) return Promise.resolve();
  return new Promise((resolve) => {
    const listener = () => {
      if (!store.isInitializing) {
        listeners.delete(listener);
        resolve();
      }
    };
    listeners.add(listener);
  });
}

export function useXmtpClient(): {
  client: XmtpClient | null;
  isInitializing: boolean;
  error: string | null;
  initialize: () => Promise<void>;
  ensureInitialized: () => Promise<XmtpClient | null>;
} {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const { address, isConnected, connector } = useAccount();
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

    if (store.isInitializing) {
      await waitForInitialization();
      return;
    }

    setStore({ isInitializing: true, error: null, walletKey: key });

    try {
      if (store.client && store.walletKey !== key) {
        store.client.close();
      }

      const created = await createXmtpClient(walletClient, address);
      setOptedIn(key);
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

  const ensureInitialized = useCallback(async (): Promise<XmtpClient | null> => {
    if (!isConnected || !address || !walletClient) {
      setStore({ client: null, error: null, walletKey: null });
      return null;
    }

    const key = address.toLowerCase();
    if (store.client && store.walletKey === key) {
      return store.client;
    }

    const provider = await connector?.getProvider?.();
    const kind = await readAccountKindFromProvider(provider, address);
    const walletError = messagingWalletError(kind);
    if (walletError) {
      setStore({
        client: null,
        isInitializing: false,
        error: walletError,
        walletKey: null,
      });
      return null;
    }

    await initialize();
    return store.client && store.walletKey === key ? store.client : null;
  }, [address, connector, initialize, isConnected, walletClient]);

  useEffect(() => {
    if (!isConnected || !address || !walletClient) return;
    const key = address.toLowerCase();
    if (!hasOptedIn(key)) return;
    if (store.client && store.walletKey === key) return;
    if (store.isInitializing) return;

    void (async () => {
      const provider = await connector?.getProvider?.();
      const kind = await readAccountKindFromProvider(provider, address);
      if (kind !== "eoa") return;
      await initialize();
    })();
  }, [address, connector, initialize, isConnected, walletClient]);

  return { client, isInitializing, error, initialize, ensureInitialized };
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

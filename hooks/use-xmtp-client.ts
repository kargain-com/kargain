"use client";

import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import type { WalletClient } from "viem";
import { useAccount, useWalletClient } from "wagmi";

import { buildXmtpClient, createXmtpClient } from "@/lib/xmtp/client";
import type { XmtpClient } from "@/lib/xmtp/helpers";
import {
  clearOptedIn,
  getCachedNetworkRegistered,
  hasOptedIn,
  isMessagingDisabledLocally,
  setOptedIn,
} from "@/lib/xmtp/messaging-preferences";
import { isOpfsLockError, OPFS_LOCK_ERROR_MESSAGE } from "@/lib/xmtp/opfs-lock-error";
import { waitForWalletClient } from "@/lib/xmtp/wait-wallet-client";
import {
  canInitializeMessaging,
  messagingWalletError,
  readAccountKindFromProvider,
} from "@/lib/web3/wallet-account";
import { DEFAULT_CHAIN_ID, wagmiChainId } from "@/lib/web3/supported-chains";

type XmtpClientStore = {
  client: XmtpClient | null;
  isInitializing: boolean;
  error: string | null;
  walletKey: string | null;
  deviceRestoreFailed: boolean;
};

let store: XmtpClientStore = {
  client: null,
  isInitializing: false,
  error: null,
  walletKey: null,
  deviceRestoreFailed: false,
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

export function closeXmtpClient(): void {
  if (store.client) {
    store.client.close();
  }
  setStore({
    client: null,
    isInitializing: false,
    error: null,
    walletKey: null,
    deviceRestoreFailed: false,
  });
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

async function runSilentRestore(address: `0x${string}`): Promise<void> {
  const key = address.toLowerCase();
  if (isMessagingDisabledLocally(key)) {
    setStore({ client: null, error: null, walletKey: null, deviceRestoreFailed: false });
    return;
  }

  if (store.client && store.walletKey === key) return;

  if (store.isInitializing) {
    await waitForInitialization();
    return;
  }

  setStore({ isInitializing: true, error: null, walletKey: key, deviceRestoreFailed: false });

  try {
    if (store.client && store.walletKey !== key) {
      store.client.close();
    }

    const built = await buildXmtpClient(address);
    if (built) {
      setOptedIn(key);
      setStore({
        client: built,
        isInitializing: false,
        error: null,
        walletKey: key,
        deviceRestoreFailed: false,
      });
      return;
    }

    setStore({
      client: null,
      isInitializing: false,
      error: null,
      walletKey: key,
      deviceRestoreFailed: true,
    });
  } catch (error) {
    if (isOpfsLockError(error)) {
      setStore({
        client: null,
        isInitializing: false,
        error: OPFS_LOCK_ERROR_MESSAGE,
        walletKey: null,
        deviceRestoreFailed: false,
      });
      return;
    }

    setStore({
      client: null,
      isInitializing: false,
      error: null,
      walletKey: key,
      deviceRestoreFailed: true,
    });
  }
}

export function shouldAttemptPassiveSilentRestore(
  optedIn: boolean,
  networkCached: boolean,
): boolean {
  return optedIn || networkCached;
}

export async function requestSilentRestore(address: `0x${string}`): Promise<void> {
  await runSilentRestore(address);
}

async function runInitialize(
  walletClient: WalletClient,
  address: `0x${string}`,
): Promise<void> {
  const key = address.toLowerCase();
  if (isMessagingDisabledLocally(key)) {
    setStore({ client: null, error: null, walletKey: null, deviceRestoreFailed: false });
    return;
  }

  if (store.client && store.walletKey === key) return;

  if (store.isInitializing) {
    await waitForInitialization();
    return;
  }

  setStore({ isInitializing: true, error: null, walletKey: key, deviceRestoreFailed: false });

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
      deviceRestoreFailed: false,
    });
  } catch (e) {
    setStore({
      client: null,
      isInitializing: false,
      error: e instanceof Error ? e.message : "Failed to initialize XMTP.",
      walletKey: null,
      deviceRestoreFailed: false,
    });
  }
}

export function useXmtpClient(): {
  client: XmtpClient | null;
  isInitializing: boolean;
  error: string | null;
  deviceRestoreFailed: boolean;
  initialize: () => Promise<void>;
  ensureInitialized: () => Promise<XmtpClient | null>;
} {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const { address, isConnected, connector } = useAccount();
  const chainId = wagmiChainId(DEFAULT_CHAIN_ID);
  const { data: walletClient } = useWalletClient({ chainId });
  const walletClientRef = useRef(walletClient);
  walletClientRef.current = walletClient;

  const walletKey = address?.toLowerCase() ?? null;
  const client =
    isConnected && walletKey && snapshot.walletKey === walletKey ? snapshot.client : null;
  const isInitializing = snapshot.isInitializing;
  const error = snapshot.error;
  const deviceRestoreFailed =
    isConnected && walletKey === snapshot.walletKey ? snapshot.deviceRestoreFailed : false;

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
        deviceRestoreFailed: false,
      });
    }
  }, [address, isConnected]);

  const resolveWalletClient = useCallback(async (): Promise<WalletClient | null> => {
    if (!isConnected || !address) return null;
    return waitForWalletClient(() => walletClientRef.current);
  }, [address, isConnected]);

  const initialize = useCallback(async () => {
    if (!isConnected || !address) {
      setStore({ client: null, error: null, walletKey: null, deviceRestoreFailed: false });
      return;
    }

    const resolved = await resolveWalletClient();
    if (!resolved) {
      setStore({
        client: null,
        isInitializing: false,
        error: "Wallet not ready. Try again.",
        walletKey: null,
        deviceRestoreFailed: false,
      });
      return;
    }

    await runInitialize(resolved, address);
  }, [address, isConnected, resolveWalletClient]);

  const ensureInitialized = useCallback(async (): Promise<XmtpClient | null> => {
    if (!isConnected || !address) {
      setStore({ client: null, error: null, walletKey: null, deviceRestoreFailed: false });
      return null;
    }

    const key = address.toLowerCase();
    if (isMessagingDisabledLocally(key)) {
      setStore({ client: null, error: null, walletKey: null, deviceRestoreFailed: false });
      return null;
    }

    if (store.client && store.walletKey === key) {
      return store.client;
    }

    const resolved = await resolveWalletClient();
    if (!resolved) {
      setStore({
        client: null,
        isInitializing: false,
        error: "Wallet not ready. Try again.",
        walletKey: null,
        deviceRestoreFailed: false,
      });
      return null;
    }

    const provider = await connector?.getProvider?.();
    const kind = await readAccountKindFromProvider(provider, address);
    if (!canInitializeMessaging(kind)) {
      setStore({
        client: null,
        isInitializing: false,
        error: messagingWalletError(kind),
        walletKey: null,
        deviceRestoreFailed: false,
      });
      return null;
    }

    await runInitialize(resolved, address);
    return store.client && store.walletKey === key ? store.client : null;
  }, [address, connector, isConnected, resolveWalletClient]);

  useEffect(() => {
    if (!isConnected || !address) return;
    const key = address.toLowerCase();
    if (isMessagingDisabledLocally(key)) return;
    if (
      !shouldAttemptPassiveSilentRestore(hasOptedIn(key), getCachedNetworkRegistered(key))
    ) {
      return;
    }
    if (store.client && store.walletKey === key) return;
    if (store.isInitializing) return;

    void (async () => {
      const provider = await connector?.getProvider?.();
      const kind = await readAccountKindFromProvider(provider, address);
      if (!canInitializeMessaging(kind)) {
        setStore({
          client: null,
          isInitializing: false,
          error: messagingWalletError(kind),
          walletKey: null,
          deviceRestoreFailed: false,
        });
        return;
      }

      await runSilentRestore(address);
    })();
  }, [address, connector, isConnected]);

  return { client, isInitializing, error, deviceRestoreFailed, initialize, ensureInitialized };
}

export function resetXmtpClientOnDisconnect(isConnected: boolean) {
  if (isConnected) return;
  closeXmtpClient();
}

export { clearOptedIn, hasOptedIn, isMessagingDisabledLocally };

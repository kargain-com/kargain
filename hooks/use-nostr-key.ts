"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAccount, useWalletClient } from "wagmi";
import {
  getNostrStorageBackendName,
  getOrCreateNostrKey,
  loadDecryptedKey,
  type WalletSigner,
} from "@/lib/nostr/key-manager";

type UseNostrKeyState = {
  nostrPrivateKey: `0x${string}` | null;
  loading: boolean;
  error: string | null;
  status: "idle" | "connecting_wallet" | "restoring" | "creating" | "ready" | "error";
  statusMessage: string;
  storageBackend: "indexeddb" | "localstorage" | null;
  refresh: () => Promise<void>;
};

export function useNostrKey(): UseNostrKeyState {
  const { isConnected } = useAccount();
  const { data: walletClient } = useWalletClient();
  const [nostrPrivateKey, setNostrPrivateKey] = useState<`0x${string}` | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<UseNostrKeyState["status"]>("idle");
  const [storageBackend, setStorageBackend] = useState<UseNostrKeyState["storageBackend"]>(null);

  const signer = useMemo<WalletSigner | null>(() => {
    const addr = walletClient?.account?.address;
    if (!walletClient || !addr) return null;
    return {
      address: addr,
      signMessage: async (message) => {
        const sig = await walletClient.signMessage({ message });
        return sig as `0x${string}`;
      },
    };
  }, [walletClient]);

  const refresh = useCallback(async () => {
    if (!isConnected || !signer) {
      setNostrPrivateKey(null);
      setStatus(isConnected ? "connecting_wallet" : "idle");
      return;
    }
    setLoading(true);
    setError(null);
    setStatus("restoring");
    try {
      setStorageBackend(await getNostrStorageBackendName());
      const existing = await loadDecryptedKey(signer);
      let key = existing;
      if (!key) {
        setStatus("creating");
        key = await getOrCreateNostrKey(signer);
      }
      setNostrPrivateKey(key);
      setStatus("ready");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load Nostr key.");
      setNostrPrivateKey(null);
      setStatus("error");
    } finally {
      setLoading(false);
    }
  }, [isConnected, signer]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const statusMessage =
    status === "idle"
      ? "Connect wallet to initialize Nostr identity."
      : status === "connecting_wallet"
        ? "Wallet connected. Preparing signer..."
        : status === "restoring"
          ? "Restoring Nostr identity..."
          : status === "creating"
            ? "Creating your Nostr identity. A one-time wallet signature may be requested."
            : status === "ready"
              ? "Nostr identity ready."
              : "Nostr key failed to initialize.";

  return { nostrPrivateKey, loading, error, status, statusMessage, storageBackend, refresh };
}

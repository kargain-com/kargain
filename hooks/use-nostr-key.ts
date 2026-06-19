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

function isSignatureRejection(err: unknown): boolean {
  if (!err) return false;
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return (
    msg.includes("reject") ||
    msg.includes("denied") ||
    msg.includes("cancel") ||
    msg.includes("refused") ||
    msg.includes("user denied")
  );
}

export function useNostrKey(): UseNostrKeyState {
  const { isConnected } = useAccount();
  const { data: walletClient } = useWalletClient();
  const [nostrPrivateKey, setNostrPrivateKey] = useState<`0x${string}` | null>(null);
  const [loading, setLoading] = useState(false);
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
    setStatus("restoring");
    try {
      setStorageBackend(await getNostrStorageBackendName());
      let key = await loadDecryptedKey(signer);
      if (!key) {
        setStatus("creating");
        key = await getOrCreateNostrKey(signer);
      }
      setNostrPrivateKey(key);
      setStatus("ready");
    } catch (e) {
      setNostrPrivateKey(null);
      setStatus(isSignatureRejection(e) ? "idle" : "error");
    } finally {
      setLoading(false);
    }
  }, [isConnected, signer]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return {
    nostrPrivateKey,
    loading,
    error: null,
    status,
    statusMessage: "",
    storageBackend,
    refresh,
  };
}

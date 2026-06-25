"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useAccount, useWalletClient } from "wagmi";
import {
  getOrCreateNostrKey,
  loadDecryptedKey,
  type WalletSigner,
} from "@/lib/nostr/key-manager";

type UseNostrKeyState = {
  nostrPrivateKey: `0x${string}` | null;
  loading: boolean;
  status: "idle" | "connecting_wallet" | "restoring" | "creating" | "ready" | "error";
  /** Restore a stored key or create one on demand (prompts wallet signature when new). */
  ensureNostrKey: () => Promise<`0x${string}` | null>;
  refresh: () => Promise<void>;
};

const NostrKeyContext = createContext<UseNostrKeyState | null>(null);

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

/** App-root provider: v1 blob silent restore; v2 on ensureNostrKey. */
export function NostrKeyProvider({ children }: { children: ReactNode }) {
  const { isConnected } = useAccount();
  const { data: walletClient } = useWalletClient();
  const [nostrPrivateKey, setNostrPrivateKey] = useState<`0x${string}` | null>(null);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<UseNostrKeyState["status"]>("idle");

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
      const key = await loadDecryptedKey(signer);
      setNostrPrivateKey(key);
      setStatus(key ? "ready" : "idle");
    } catch (e) {
      setNostrPrivateKey(null);
      setStatus(isSignatureRejection(e) ? "idle" : "error");
    } finally {
      setLoading(false);
    }
  }, [isConnected, signer]);

  const ensureNostrKey = useCallback(async (): Promise<`0x${string}` | null> => {
    if (!isConnected || !signer) return null;
    if (nostrPrivateKey) return nostrPrivateKey;

    setLoading(true);
    setStatus("creating");
    try {
      const key = await getOrCreateNostrKey(signer);
      setNostrPrivateKey(key);
      setStatus("ready");
      return key;
    } catch (e) {
      setNostrPrivateKey(null);
      setStatus(isSignatureRejection(e) ? "idle" : "error");
      return null;
    } finally {
      setLoading(false);
    }
  }, [isConnected, nostrPrivateKey, signer]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo(
    () => ({
      nostrPrivateKey,
      loading,
      status,
      ensureNostrKey,
      refresh,
    }),
    [nostrPrivateKey, loading, status, ensureNostrKey, refresh],
  );

  return <NostrKeyContext.Provider value={value}>{children}</NostrKeyContext.Provider>;
}

export function useNostrKey(): UseNostrKeyState {
  const ctx = useContext(NostrKeyContext);
  if (!ctx) {
    throw new Error("useNostrKey must be used within NostrKeyProvider");
  }
  return ctx;
}

"use client";

import { useActiveAccount, requireEvmSession } from "@/hooks/use-active-account";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useWalletClient } from "wagmi";

import { useWalletAccountKind } from "@/hooks/use-wallet-account-kind";
import { getOrCreateNostrKey, type WalletSigner } from "@/lib/nostr/key-manager";
import { getNostrPool, nostrPubkeyFromPrivateKey } from "@/lib/nostr/nostr-client";
import {
  loadCachedPubkey,
  saveCachedPubkey,
} from "@/lib/nostr/nostr-pubkey-cache";
import { attestedPubkeyForAddress } from "@/lib/nostr/resolve-attested-profile";
import { supportsPersonalSignIdentity } from "@/lib/web3/wallet-account";

type UseNostrKeyState = {
  nostrPrivateKey: `0x${string}` | null;
  /** Public key from memory or local cache — enables read-only Nostr without signature. */
  nostrPubkey: string | null;
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

function persistPubkeyForAddress(address: `0x${string}`, privateKey: `0x${string}`): void {
  saveCachedPubkey(address, nostrPubkeyFromPrivateKey(privateKey));
}

/** App-root provider: passive pubkey restore; private key only after ensureNostrKey. */
export function NostrKeyProvider({ children }: { children: ReactNode }) {
  const { account, signingBinding } = useActiveAccount();
  const evm = requireEvmSession(account);
  const address = evm.ok ? evm.address : undefined;
  const isConnected = evm.ok;
  const connector = signingBinding.ok ? signingBinding.connector : undefined;
  const { data: walletClient } = useWalletClient();
  const { kind: accountKind, isLoading: accountKindLoading } = useWalletAccountKind(
    isConnected ? address : undefined,
    connector,
  );
  const [nostrPrivateKey, setNostrPrivateKey] = useState<`0x${string}` | null>(null);
  const [cachedPubkey, setCachedPubkey] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [passiveResolveLoading, setPassiveResolveLoading] = useState(false);
  const [status, setStatus] = useState<UseNostrKeyState["status"]>("idle");
  const attemptedPassiveRef = useRef(new Set<string>());
  const nostrPrivateKeyRef = useRef(nostrPrivateKey);
  nostrPrivateKeyRef.current = nostrPrivateKey;

  const signer = useMemo<WalletSigner | null>(() => {
    const addr = walletClient?.account?.address;
    if (!walletClient || !addr) return null;
    return {
      address: addr,
      accountKind: accountKind ?? undefined,
      signMessage: async (message) => {
        const sig = await walletClient.signMessage({ message });
        return sig as `0x${string}`;
      },
    };
  }, [walletClient, accountKind]);

  useEffect(() => {
    if (!isConnected || !address) {
      setCachedPubkey(null);
      return;
    }

    const cached = loadCachedPubkey(address);
    if (cached) {
      setCachedPubkey(cached);
      return;
    }

    setCachedPubkey(null);

    const addressKey = address.toLowerCase();
    if (nostrPrivateKey || attemptedPassiveRef.current.has(addressKey)) {
      return;
    }

    attemptedPassiveRef.current.add(addressKey);
    let cancelled = false;
    setPassiveResolveLoading(true);

    void (async () => {
      try {
        const pubkey = await attestedPubkeyForAddress(address, { pool: getNostrPool() });
        if (cancelled) return;
        if (nostrPrivateKeyRef.current) return;
        if (loadCachedPubkey(address)) return;
        if (!pubkey) return;

        saveCachedPubkey(address, pubkey);
        setCachedPubkey(pubkey);
      } finally {
        setPassiveResolveLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isConnected, address, nostrPrivateKey]);

  const nostrPubkey = useMemo(() => {
    if (nostrPrivateKey) return nostrPubkeyFromPrivateKey(nostrPrivateKey);
    return cachedPubkey;
  }, [nostrPrivateKey, cachedPubkey]);

  const refresh = useCallback(async () => {
    if (!isConnected || !address) {
      setNostrPrivateKey(null);
      setStatus(isConnected ? "connecting_wallet" : "idle");
      return;
    }
    // Private key requires an explicit ensureNostrKey (wallet signature).
    // Passive pubkey cache still enables read-only paths.
    if (!nostrPrivateKeyRef.current) {
      setNostrPrivateKey(null);
      setStatus("idle");
    }
  }, [isConnected, address]);

  const ensureNostrKey = useCallback(async (): Promise<`0x${string}` | null> => {
    if (!isConnected || !signer || !address) return null;
    if (nostrPrivateKey) return nostrPrivateKey;
    if (accountKindLoading) return null;
    if (accountKind != null && !supportsPersonalSignIdentity(accountKind)) {
      setStatus("error");
      return null;
    }

    setLoading(true);
    setStatus("creating");
    try {
      const key = await getOrCreateNostrKey(signer);
      setNostrPrivateKey(key);
      persistPubkeyForAddress(address, key);
      setCachedPubkey(nostrPubkeyFromPrivateKey(key));
      setStatus("ready");
      return key;
    } catch (e) {
      setNostrPrivateKey(null);
      setStatus(isSignatureRejection(e) ? "idle" : "error");
      return null;
    } finally {
      setLoading(false);
    }
  }, [
    isConnected,
    nostrPrivateKey,
    signer,
    address,
    accountKind,
    accountKindLoading,
  ]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo(
    () => ({
      nostrPrivateKey,
      nostrPubkey,
      loading: loading || passiveResolveLoading || accountKindLoading,
      status,
      ensureNostrKey,
      refresh,
    }),
    [
      nostrPrivateKey,
      nostrPubkey,
      loading,
      passiveResolveLoading,
      accountKindLoading,
      status,
      ensureNostrKey,
      refresh,
    ],
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

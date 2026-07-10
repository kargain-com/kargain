"use client";

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
import { useAccount, useWalletClient } from "wagmi";
import {
  getOrCreateNostrKey,
  loadDecryptedKey,
  type WalletSigner,
} from "@/lib/nostr/key-manager";
import { migrateNostrIdentity } from "@/lib/nostr/migrate-identity";
import { getNostrPool, nostrPubkeyFromPrivateKey } from "@/lib/nostr/nostr-client";
import {
  loadCachedPubkey,
  saveCachedPubkey,
} from "@/lib/nostr/nostr-pubkey-cache";
import { attestedPubkeyForAddress } from "@/lib/nostr/resolve-attested-profile";

export type IdentityMismatchState = false | true | "persistent";

type UseNostrKeyState = {
  nostrPrivateKey: `0x${string}` | null;
  /** Public key from memory or local cache — enables read-only Nostr without signature. */
  nostrPubkey: string | null;
  loading: boolean;
  status: "idle" | "connecting_wallet" | "restoring" | "creating" | "ready" | "error";
  identityMismatch: IdentityMismatchState;
  /** Restore a stored key or create one on demand (prompts wallet signature when new). */
  ensureNostrKey: () => Promise<`0x${string}` | null>;
  /** Retry canonical signature when derived pubkey differs from attested. */
  resolveIdentity: () => Promise<boolean>;
  /** Copy profile, watchlist, and notification state to a new derived key. */
  migrateIdentity: () => Promise<boolean>;
  /** Last resolve/migrate failure message for profile relink UI. */
  identityError: string | null;
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

function normalizePubkeyHex(pubkey: string): string {
  return pubkey.trim().toLowerCase();
}

function persistPubkeyForAddress(address: `0x${string}`, privateKey: `0x${string}`): void {
  saveCachedPubkey(address, nostrPubkeyFromPrivateKey(privateKey));
}

/** App-root provider: v1 blob silent restore; v2 on ensureNostrKey. */
export function NostrKeyProvider({ children }: { children: ReactNode }) {
  const { isConnected, address } = useAccount();
  const { data: walletClient } = useWalletClient();
  const [nostrPrivateKey, setNostrPrivateKey] = useState<`0x${string}` | null>(null);
  const [cachedPubkey, setCachedPubkey] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [passiveResolveLoading, setPassiveResolveLoading] = useState(false);
  const [status, setStatus] = useState<UseNostrKeyState["status"]>("idle");
  const [identityMismatch, setIdentityMismatch] = useState<IdentityMismatchState>(false);
  const [identityError, setIdentityError] = useState<string | null>(null);
  const attemptedPassiveRef = useRef(new Set<string>());
  const attestedPubkeyRef = useRef<string | null>(null);
  const nostrPrivateKeyRef = useRef(nostrPrivateKey);
  nostrPrivateKeyRef.current = nostrPrivateKey;

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

  const resolveKnownAttestedPubkey = useCallback(
    async (addr: `0x${string}`, cache: string | null): Promise<string | null> => {
      if (cache?.trim()) {
        attestedPubkeyRef.current = cache.trim();
        return cache.trim();
      }
      if (attestedPubkeyRef.current) {
        return attestedPubkeyRef.current;
      }
      const pubkey = await attestedPubkeyForAddress(addr, { pool: getNostrPool() });
      if (pubkey) {
        attestedPubkeyRef.current = pubkey;
      }
      return pubkey;
    },
    [],
  );

  const applyKeyIfMatchesAttested = useCallback(
    (
      key: `0x${string}`,
      attested: string | null,
      addr: `0x${string}`,
    ): `0x${string}` | null => {
      if (!attested) {
        setNostrPrivateKey(key);
        persistPubkeyForAddress(addr, key);
        setCachedPubkey(nostrPubkeyFromPrivateKey(key));
        setIdentityMismatch(false);
        setStatus("ready");
        return key;
      }

      const derived = normalizePubkeyHex(nostrPubkeyFromPrivateKey(key));
      if (derived !== normalizePubkeyHex(attested)) {
        setIdentityMismatch(true);
        return null;
      }

      setNostrPrivateKey(key);
      persistPubkeyForAddress(addr, key);
      setCachedPubkey(derived);
      setIdentityMismatch(false);
      setStatus("ready");
      return key;
    },
    [],
  );

  useEffect(() => {
    if (!isConnected || !address) {
      setCachedPubkey(null);
      setIdentityMismatch(false);
      setIdentityError(null);
      attestedPubkeyRef.current = null;
      return;
    }

    const cached = loadCachedPubkey(address);
    if (cached) {
      setCachedPubkey(cached);
      attestedPubkeyRef.current = cached;
      return;
    }

    setCachedPubkey(null);
    attestedPubkeyRef.current = null;
    setIdentityMismatch(false);
    setIdentityError(null);

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

        attestedPubkeyRef.current = pubkey;
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
    if (!isConnected || !signer || !address) {
      setNostrPrivateKey(null);
      setStatus(isConnected ? "connecting_wallet" : "idle");
      return;
    }
    setLoading(true);
    setStatus("restoring");
    try {
      const key = await loadDecryptedKey(signer);
      setNostrPrivateKey(key);
      if (key) {
        persistPubkeyForAddress(address, key);
        setCachedPubkey(nostrPubkeyFromPrivateKey(key));
      }
      setStatus(key ? "ready" : "idle");
    } catch (e) {
      setNostrPrivateKey(null);
      setStatus(isSignatureRejection(e) ? "idle" : "error");
    } finally {
      setLoading(false);
    }
  }, [isConnected, signer, address]);

  const ensureNostrKey = useCallback(async (): Promise<`0x${string}` | null> => {
    if (!isConnected || !signer || !address) return null;
    if (nostrPrivateKey && identityMismatch === false) return nostrPrivateKey;

    setLoading(true);
    setStatus("creating");
    setIdentityError(null);
    try {
      const key = await getOrCreateNostrKey(signer);
      const attested = await resolveKnownAttestedPubkey(address, cachedPubkey);
      return applyKeyIfMatchesAttested(key, attested, address);
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
    identityMismatch,
    signer,
    address,
    cachedPubkey,
    resolveKnownAttestedPubkey,
    applyKeyIfMatchesAttested,
  ]);

  const resolveIdentity = useCallback(async (): Promise<boolean> => {
    if (!isConnected || !signer || !address) return false;

    const attested = await resolveKnownAttestedPubkey(address, cachedPubkey);
    if (!attested) return false;

    setLoading(true);
    setStatus("creating");
    setIdentityError(null);
    try {
      const key = await getOrCreateNostrKey(signer);
      const derived = normalizePubkeyHex(nostrPubkeyFromPrivateKey(key));
      if (derived !== normalizePubkeyHex(attested)) {
        setIdentityMismatch("persistent");
        return false;
      }
      applyKeyIfMatchesAttested(key, attested, address);
      return true;
    } catch (e) {
      setNostrPrivateKey(null);
      const message = e instanceof Error ? e.message : String(e);
      setIdentityError(message || null);
      setStatus(isSignatureRejection(e) ? "idle" : "error");
      return false;
    } finally {
      setLoading(false);
    }
  }, [
    isConnected,
    signer,
    address,
    cachedPubkey,
    resolveKnownAttestedPubkey,
    applyKeyIfMatchesAttested,
  ]);

  const migrateIdentity = useCallback(async (): Promise<boolean> => {
    if (!isConnected || !signer || !address || identityMismatch !== "persistent") {
      return false;
    }

    const oldPubkey = attestedPubkeyRef.current ?? cachedPubkey;
    if (!oldPubkey) return false;

    setLoading(true);
    setStatus("creating");
    setIdentityError(null);
    try {
      const key = await getOrCreateNostrKey(signer);
      const result = await migrateNostrIdentity({
        address,
        oldPubkey,
        newPrivateKey: key,
        signMessage: signer.signMessage,
      });
      if (!result.ok) {
        setIdentityError(result.error);
        return false;
      }

      setNostrPrivateKey(key);
      const newPubkey = nostrPubkeyFromPrivateKey(key);
      saveCachedPubkey(address, newPubkey);
      setCachedPubkey(newPubkey);
      attestedPubkeyRef.current = newPubkey;
      setIdentityMismatch(false);
      setStatus("ready");
      return true;
    } catch (e) {
      setNostrPrivateKey(null);
      const message = e instanceof Error ? e.message : String(e);
      setIdentityError(message || null);
      setStatus(isSignatureRejection(e) ? "idle" : "error");
      return false;
    } finally {
      setLoading(false);
    }
  }, [isConnected, signer, address, identityMismatch, cachedPubkey]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo(
    () => ({
      nostrPrivateKey,
      nostrPubkey,
      loading: loading || passiveResolveLoading,
      status,
      identityMismatch,
      identityError,
      ensureNostrKey,
      resolveIdentity,
      migrateIdentity,
      refresh,
    }),
    [
      nostrPrivateKey,
      nostrPubkey,
      loading,
      passiveResolveLoading,
      status,
      identityMismatch,
      identityError,
      ensureNostrKey,
      resolveIdentity,
      migrateIdentity,
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

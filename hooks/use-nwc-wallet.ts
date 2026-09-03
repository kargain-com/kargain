"use client";

import { useActiveAccount, requireEvmSession } from "@/hooks/use-active-account";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { useWalletClient } from "wagmi";

import { nwcLinkMessage } from "@/lib/nostr/key-manager-crypto";
import {
  fetchWalletInfo,
  payInvoice as nwcPayInvoice,
  type NwcEncryption,
  type NwcErrorCode,
  type NwcPayResult,
} from "@/lib/nostr/nwc/nwc-client";
import { parseNwcUri, type ParsedNwcConnection } from "@/lib/nostr/nwc/nwc-uri";
import {
  clearNwcConnection,
  hasNwcConnection,
  loadNwcConnection,
  saveNwcConnection,
} from "@/lib/nostr/nwc/nwc-store";

type CachedNwc = {
  conn: ParsedNwcConnection;
  encryption: NwcEncryption;
};

const decryptedCache = new Map<string, CachedNwc>();

const PRESENCE_KEY_PREFIX = "kargain_nwc_present_v1:";

const presenceListeners = new Set<() => void>();

function notifyPresenceChange(): void {
  for (const listener of presenceListeners) listener();
}

function subscribePresence(listener: () => void): () => void {
  presenceListeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key.startsWith(PRESENCE_KEY_PREFIX)) {
      listener();
    }
  };
  if (typeof window !== "undefined") {
    window.addEventListener("storage", onStorage);
  }
  return () => {
    presenceListeners.delete(listener);
    if (typeof window !== "undefined") {
      window.removeEventListener("storage", onStorage);
    }
  };
}

export type NwcConnectErrorCode =
  | "invalid_uri"
  | "unsupported"
  | "relay_unreachable"
  | "sign_rejected"
  | "storage_failed"
  | "wallet_disconnected"
  | "wrong_vm";

export type NwcConnectResult =
  | { ok: true }
  | { ok: false; code: NwcConnectErrorCode };

function cacheKey(address: `0x${string}`): string {
  return address.toLowerCase();
}

function clearCacheForAddress(address: `0x${string}`): void {
  decryptedCache.delete(cacheKey(address));
}

export function nwcPayErrorMessage(code: NwcErrorCode): string {
  switch (code) {
    case "rejected":
      return "Your wallet declined the payment.";
    case "insufficient_balance":
      return "Insufficient wallet balance.";
    case "timeout":
      return "No response from your wallet. Check the wallet app.";
    case "unlock_declined":
      return "Approve the signature request to pay from your connected wallet.";
    case "relay_unreachable":
    case "invalid_response":
    case "unsupported":
      return "Could not reach your Lightning wallet.";
    default:
      return "Could not reach your Lightning wallet.";
  }
}

export function useNwcWallet() {
  const { account } = useActiveAccount();
  const evm = requireEvmSession(account);
  const address = evm.ok ? evm.address : undefined;
  const { data: walletClient } = useWalletClient();

  const present = useSyncExternalStore(
    subscribePresence,
    () => (address ? hasNwcConnection(address) : false),
    () => false,
  );

  useEffect(() => {
    return () => {
      if (address) clearCacheForAddress(address);
    };
  }, [address]);

  const disconnect = useCallback(async () => {
    if (!address) return;
    clearCacheForAddress(address);
    await clearNwcConnection(address);
    notifyPresenceChange();
  }, [address]);

  const unlockCached = useCallback(async (): Promise<CachedNwc | null> => {
    if (!address || !walletClient) return null;

    const key = cacheKey(address);
    const hit = decryptedCache.get(key);
    if (hit) return hit;

    let signature: `0x${string}`;
    try {
      signature = await walletClient.signMessage({
        message: nwcLinkMessage(address),
      });
    } catch {
      return null;
    }

    const conn = await loadNwcConnection(address, signature);
    if (!conn) return null;

    let encryption: NwcEncryption = "nip44";
    try {
      const info = await fetchWalletInfo(conn);
      encryption = info.encryption;
    } catch {
      encryption = "nip44";
    }

    const cached = { conn, encryption };
    decryptedCache.set(key, cached);
    return cached;
  }, [address, walletClient]);

  const connect = useCallback(
    async (uri: string): Promise<NwcConnectResult> => {
      if (!evm.ok) {
        return {
          ok: false,
          code: evm.cause === "wrong_vm" ? "wrong_vm" : "wallet_disconnected",
        };
      }
      if (!walletClient) {
        return { ok: false, code: "wallet_disconnected" };
      }
      const address = evm.address;

      const parsed = parseNwcUri(uri);
      if (!parsed) {
        return { ok: false, code: "invalid_uri" };
      }

      let info;
      try {
        info = await fetchWalletInfo(parsed);
      } catch {
        return { ok: false, code: "relay_unreachable" };
      }

      if (!info.supportsPayInvoice) {
        return { ok: false, code: "unsupported" };
      }

      let signature: `0x${string}`;
      try {
        signature = await walletClient.signMessage({
          message: nwcLinkMessage(address),
        });
      } catch {
        return { ok: false, code: "sign_rejected" };
      }

      try {
        await saveNwcConnection(address, signature, uri.trim());
      } catch {
        return { ok: false, code: "storage_failed" };
      }

      decryptedCache.set(cacheKey(address), { conn: parsed, encryption: info.encryption });
      notifyPresenceChange();
      return { ok: true };
    },
    [evm, walletClient],
  );

  const payInvoice = useCallback(
    async (invoice: string): Promise<NwcPayResult> => {
      const cached = await unlockCached();
      if (!cached) {
        return { ok: false, code: "unlock_declined" };
      }

      return nwcPayInvoice(cached.conn, invoice, { encryption: cached.encryption });
    },
    [unlockCached],
  );

  return { present, connect, disconnect, payInvoice };
}

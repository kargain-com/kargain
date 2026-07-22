"use client";

import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import type { Address, WalletClient } from "viem";
import { useAccount, useChainId, useWalletClient } from "wagmi";

import { createInMemoryMessagingCache, createMessagingCachePort } from "@/lib/messaging/adapters/cache-adapter";
import { createNostrPolicyAdapter } from "@/lib/messaging/adapters/nostr-adapter";
import { createWalletAdapter } from "@/lib/messaging/adapters/wallet-adapter";
import { createXmtpAdapter, type XmtpSdkClient } from "@/lib/messaging/adapters/xmtp-adapter";
import type { MessagingSession, SessionCommand, SessionSnapshot } from "@/lib/messaging/ports";
import { createMessagingSession } from "@/lib/messaging/session-store";
import { getMessagingXmtpEnv } from "@/lib/messaging/xmtp-env";
import { resolveWalletCommercialChainId } from "@/lib/web3/chain-context";
import { wagmiChainId } from "@/lib/web3/supported-chains";

type SessionRefs = {
  address: Address;
  walletClient: WalletClient | undefined;
  commercialChainId: number | null;
};

type SessionEntry = {
  session: MessagingSession;
  refs: SessionRefs;
};

const sessions = new Map<string, SessionEntry>();

const DISCONNECTED_SNAPSHOT: SessionSnapshot = { state: "disconnected" };

const browserClock = {
  nowMs: () => Date.now(),
  sleep: (ms: number, signal?: AbortSignal) =>
    new Promise<void>((resolve, reject) => {
      if (signal?.aborted) {
        reject(new DOMException("Aborted", "AbortError"));
        return;
      }
      const timer = setTimeout(resolve, ms);
      signal?.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          reject(new DOMException("Aborted", "AbortError"));
        },
        { once: true },
      );
    }),
};

/** XMTP identity is address-scoped — session key must not pin a hub chain. */
function sessionKey(address: string): string {
  return address.toLowerCase();
}

function getOrCreateEntry(address: Address): SessionEntry {
  const key = sessionKey(address);
  const existing = sessions.get(key);
  if (existing) return existing;

  const refs: SessionRefs = {
    address,
    walletClient: undefined,
    commercialChainId: null,
  };
  const wallet = createWalletAdapter({
    getAddress: () => refs.address,
    getWalletClient: () => refs.walletClient,
    getChainId: () => refs.commercialChainId,
    clock: browserClock,
  });
  const xmtp = createXmtpAdapter({
    getWalletClient: () => refs.walletClient,
  });
  const nostr = createNostrPolicyAdapter({
    getAddress: () => refs.address,
    getWalletClient: () => refs.walletClient,
  });
  const cache =
    typeof localStorage === "undefined"
      ? createInMemoryMessagingCache()
      : createMessagingCachePort(getMessagingXmtpEnv());

  const session = createMessagingSession({
    address,
    ports: { xmtp, nostr, wallet },
    clock: browserClock,
    cache,
  });

  const entry = { session, refs };
  sessions.set(key, entry);
  return entry;
}

function disposeEntry(address: string): void {
  const key = sessionKey(address);
  const entry = sessions.get(key);
  if (!entry) return;
  entry.session.dispose();
  sessions.delete(key);
}

export function useMessagingSession(): {
  snapshot: SessionSnapshot;
  dispatch: (command: SessionCommand) => void;
  client: XmtpSdkClient | null;
  session: MessagingSession | null;
} {
  const { address, isConnected } = useAccount();
  const walletChainId = useChainId();
  const commercialChainId = resolveWalletCommercialChainId(walletChainId);
  const { data: walletClient } = useWalletClient(
    commercialChainId != null ? { chainId: wagmiChainId(commercialChainId) } : {},
  );

  const activeKey = address && isConnected ? sessionKey(address) : null;
  const entry = activeKey ? (sessions.get(activeKey) ?? null) : null;

  const prevAddressRef = useRef<string | null>(null);

  useEffect(() => {
    const prev = prevAddressRef.current;
    if (prev && (!address || !isConnected || prev !== address)) {
      disposeEntry(prev);
    }
    prevAddressRef.current = address && isConnected ? address : null;
  }, [address, isConnected]);

  useEffect(() => {
    if (!address || !isConnected) return;
    const current = getOrCreateEntry(address);
    current.refs.address = address;
    current.refs.walletClient = walletClient;
    current.refs.commercialChainId = commercialChainId;
    current.session.syncWalletAddress();
    current.session.start();
  }, [address, commercialChainId, isConnected, walletClient]);

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      if (!entry) return () => {};
      return entry.session.subscribe(onStoreChange);
    },
    [entry],
  );

  const getSnapshot = useCallback((): SessionSnapshot => {
    if (!entry || !address || !isConnected) {
      return DISCONNECTED_SNAPSHOT;
    }
    return entry.session.getSnapshot();
  }, [entry, address, isConnected]);

  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const dispatch = useCallback(
    (command: SessionCommand) => {
      entry?.session.dispatch(command);
    },
    [entry],
  );

  const client =
    entry && address && isConnected ? entry.session.getXmtpClient() : null;

  return { snapshot, dispatch, client, session: entry?.session ?? null };
}

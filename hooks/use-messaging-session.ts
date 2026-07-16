"use client";

import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import type { Address, WalletClient } from "viem";
import { useAccount, useWalletClient } from "wagmi";

import { createInMemoryMessagingCache, createMessagingCachePort } from "@/lib/messaging/adapters/cache-adapter";
import { createNostrPolicyAdapter } from "@/lib/messaging/adapters/nostr-adapter";
import { createWalletAdapter } from "@/lib/messaging/adapters/wallet-adapter";
import { createXmtpAdapter, type XmtpSdkClient } from "@/lib/messaging/adapters/xmtp-adapter";
import type { MessagingSession, SessionCommand, SessionSnapshot } from "@/lib/messaging/ports";
import { createMessagingSession } from "@/lib/messaging/session-store";
import { getMessagingXmtpEnv } from "@/lib/messaging/xmtp-env";
import { DEFAULT_CHAIN_ID, wagmiChainId } from "@/lib/web3/supported-chains";

type SessionRefs = {
  address: Address;
  walletClient: WalletClient | undefined;
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

function sessionKey(chainId: number, address: string): string {
  return `${chainId}:${address.toLowerCase()}`;
}

function getOrCreateEntry(chainId: number, address: Address): SessionEntry {
  const key = sessionKey(chainId, address);
  const existing = sessions.get(key);
  if (existing) return existing;

  const refs: SessionRefs = { address, walletClient: undefined };
  const wallet = createWalletAdapter({
    getAddress: () => refs.address,
    getWalletClient: () => refs.walletClient,
    chainId,
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

function disposeEntry(chainId: number, address: string): void {
  const key = sessionKey(chainId, address);
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
  const chainId = wagmiChainId(DEFAULT_CHAIN_ID);
  const { data: walletClient } = useWalletClient({ chainId });

  const activeKey =
    address && isConnected ? sessionKey(chainId, address) : null;
  const entry = activeKey ? (sessions.get(activeKey) ?? null) : null;

  const prevAddressRef = useRef<string | null>(null);

  useEffect(() => {
    const prev = prevAddressRef.current;
    if (prev && (!address || !isConnected || prev !== address)) {
      disposeEntry(chainId, prev);
    }
    prevAddressRef.current = address && isConnected ? address : null;
  }, [address, chainId, isConnected]);

  useEffect(() => {
    if (!address || !isConnected) return;
    const current = getOrCreateEntry(chainId, address);
    current.refs.address = address;
    current.refs.walletClient = walletClient;
    current.session.syncWalletAddress();
    current.session.start();
  }, [address, chainId, isConnected, walletClient]);

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

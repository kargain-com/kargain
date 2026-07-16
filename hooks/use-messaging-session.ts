"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
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

  const entryRef = useRef<SessionEntry | null>(null);
  const [sessionEpoch, setSessionEpoch] = useState(0);

  const prevAddressRef = useRef<string | null>(null);

  useEffect(() => {
    const prev = prevAddressRef.current;
    if (prev && (!address || !isConnected || prev !== address)) {
      disposeEntry(chainId, prev);
    }
    prevAddressRef.current = address && isConnected ? address : null;

    if (!address || !isConnected) {
      entryRef.current = null;
      setSessionEpoch((value) => value + 1);
      return;
    }

    const entry = getOrCreateEntry(chainId, address);
    entry.refs.address = address;
    entry.refs.walletClient = walletClient;
    entry.session.syncWalletAddress();
    entry.session.start();
    entryRef.current = entry;
    setSessionEpoch((value) => value + 1);
  }, [address, chainId, isConnected, walletClient]);

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const entry = entryRef.current;
      if (!entry) return () => {};
      return entry.session.subscribe(onStoreChange);
    },
    [sessionEpoch],
  );

  const getSnapshot = useCallback((): SessionSnapshot => {
    if (!entryRef.current || !address || !isConnected) {
      return { state: "disconnected" };
    }
    return entryRef.current.session.getSnapshot();
  }, [sessionEpoch, address, isConnected]);

  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const dispatch = useCallback(
    (command: SessionCommand) => {
      entryRef.current?.session.dispatch(command);
    },
    [sessionEpoch],
  );

  const entry = entryRef.current;
  const client =
    entry && address && isConnected ? entry.session.getXmtpClient() : null;

  return { snapshot, dispatch, client, session: entry?.session ?? null };
}

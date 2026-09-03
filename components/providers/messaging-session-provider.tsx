"use client";

import { useActiveAccount, requireEvmSession } from "@/hooks/use-active-account";

import {
  createContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type { Address, WalletClient } from "viem";
import { useWalletClient } from "wagmi";

import {
  createInMemoryMessagingCache,
  createMessagingCachePort,
} from "@/lib/messaging/adapters/cache-adapter";
import { createNostrPolicyAdapter } from "@/lib/messaging/adapters/nostr-adapter";
import { createWalletAdapter } from "@/lib/messaging/adapters/wallet-adapter";
import {
  createXmtpAdapter,
  preloadXmtp,
  type XmtpSdkClient,
} from "@/lib/messaging/adapters/xmtp-adapter";
import type {
  MessagingSession,
  NostrIdentityCapability,
  SessionCommand,
  SessionSnapshot,
} from "@/lib/messaging/ports";
import { createSessionRegistry } from "@/lib/messaging/session-registry";
import { createMessagingSession } from "@/lib/messaging/session-store";
import { shouldIdleWarmXmtp } from "@/lib/messaging/snapshot-ui";
import { getMessagingXmtpEnv } from "@/lib/messaging/xmtp-env";
import { useNostrKey } from "@/hooks/use-nostr-key";
import { resolveWalletCommercialChainId } from "@/lib/web3/chain-context";
import { wagmiChainId } from "@/lib/web3/supported-chains";

type SessionRefs = {
  address: Address;
  walletClient: WalletClient | undefined;
  commercialChainId: number | null;
  /** Latest identity facts — mutated each render like walletClient. */
  nostrPrivateKey: `0x${string}` | null;
  nostrStatus: "idle" | "connecting_wallet" | "restoring" | "creating" | "ready" | "error";
  ensureNostrKey: () => Promise<`0x${string}` | null>;
  isConnected: boolean;
  attestationValidByAddress: Map<string, boolean>;
};

export type MessagingSessionContextValue = {
  snapshot: SessionSnapshot;
  dispatch: (command: SessionCommand) => void;
  client: XmtpSdkClient | null;
  session: MessagingSession | null;
};

const DISCONNECTED_SNAPSHOT: SessionSnapshot = { state: "disconnected" };

const DISCONNECTED_VALUE: MessagingSessionContextValue = {
  snapshot: DISCONNECTED_SNAPSHOT,
  dispatch: () => {},
  client: null,
  session: null,
};

export const MessagingSessionContext =
  createContext<MessagingSessionContextValue | null>(null);

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

const registry = createSessionRegistry<MessagingSession>();

/** Mutable wallet/chain bag for adapters — not a React ref (readable during render). */
const sessionRefsByAddress = new Map<string, SessionRefs>();

function sessionKey(address: string): string {
  return address.toLowerCase();
}

function identityFromRefs(refs: SessionRefs): NostrIdentityCapability {
  return {
    async obtainKey() {
      if (!refs.isConnected || !refs.address) return { status: "unavailable" };
      if (refs.nostrPrivateKey) {
        return { status: "ready", privateKey: refs.nostrPrivateKey };
      }
      const key = await refs.ensureNostrKey();
      if (key) return { status: "ready", privateKey: key };
      if (refs.nostrStatus === "error") return { status: "error" };
      if (refs.nostrStatus === "idle") return { status: "declined" };
      return { status: "unavailable" };
    },
    isKeyHeld() {
      return refs.nostrPrivateKey != null;
    },
    getAttestationValidCached() {
      const cached = refs.attestationValidByAddress.get(sessionKey(refs.address));
      return cached === undefined ? null : cached;
    },
    markAttestationValid(valid) {
      refs.attestationValidByAddress.set(sessionKey(refs.address), valid);
    },
  };
}

function createSessionForAddress(address: Address, refs: SessionRefs): MessagingSession {
  const wallet = createWalletAdapter({
    getAddress: () => refs.address,
    getWalletClient: () => refs.walletClient,
    getChainId: () => refs.commercialChainId,
    clock: browserClock,
  });
  const xmtp = createXmtpAdapter({
    getWalletClient: () => refs.walletClient,
  });
  const identity = identityFromRefs(refs);
  const nostr = createNostrPolicyAdapter({
    getAddress: () => refs.address,
    getWalletClient: () => refs.walletClient,
    identity,
  });
  const cache =
    typeof localStorage === "undefined"
      ? createInMemoryMessagingCache()
      : createMessagingCachePort(getMessagingXmtpEnv());

  return createMessagingSession({
    address,
    ports: { xmtp, nostr, wallet },
    clock: browserClock,
    cache,
  });
}

function scheduleIdle(fn: () => void): () => void {
  if (typeof requestIdleCallback === "function") {
    const id = requestIdleCallback(() => fn());
    return () => cancelIdleCallback(id);
  }
  const id = setTimeout(fn, 0);
  return () => clearTimeout(id);
}

function ensureRefs(
  key: string,
  address: Address,
  walletClient: WalletClient | undefined,
  commercialChainId: number | null,
  nostrPrivateKey: `0x${string}` | null,
  nostrStatus: SessionRefs["nostrStatus"],
  ensureNostrKey: () => Promise<`0x${string}` | null>,
  isConnected: boolean,
): SessionRefs {
  let refs = sessionRefsByAddress.get(key);
  if (!refs) {
    refs = {
      address,
      walletClient,
      commercialChainId,
      nostrPrivateKey,
      nostrStatus,
      ensureNostrKey,
      isConnected,
      attestationValidByAddress: new Map(),
    };
    sessionRefsByAddress.set(key, refs);
  } else {
    refs.address = address;
    refs.walletClient = walletClient;
    refs.commercialChainId = commercialChainId;
    refs.nostrPrivateKey = nostrPrivateKey;
    refs.nostrStatus = nostrStatus;
    refs.ensureNostrKey = ensureNostrKey;
    refs.isConnected = isConnected;
  }
  return refs;
}

export function MessagingSessionProvider({ children }: { children: ReactNode }) {
  const { account } = useActiveAccount();
  const evm = requireEvmSession(account);
  const address = evm.ok ? evm.address : undefined;
  const isConnected = evm.ok;
  const walletChainId = evm.ok ? evm.chainId : undefined;

      const commercialChainId = resolveWalletCommercialChainId(walletChainId);
  const { data: walletClient } = useWalletClient(
    commercialChainId != null ? { chainId: wagmiChainId(commercialChainId) } : {},
  );
  const {
    nostrPrivateKey,
    ensureNostrKey,
    status: nostrStatus,
  } = useNostrKey();

  const nextKey = address && isConnected ? sessionKey(address) : null;
  const [heldKey, setHeldKey] = useState<string | null>(null);

  let session: MessagingSession | null = null;

  if (nextKey && address) {
    const refs = ensureRefs(
      nextKey,
      address,
      walletClient,
      commercialChainId,
      nostrPrivateKey,
      nostrStatus,
      ensureNostrKey,
      isConnected,
    );
    if (heldKey !== nextKey) {
      registry.acquire(address, () => createSessionForAddress(address, refs));
      setHeldKey(nextKey);
    }
    session = registry.get(address);
  } else if (heldKey !== null) {
    setHeldKey(null);
  }

  useEffect(() => {
    if (nextKey) {
      registry.get(nextKey)?.start();
    }
    return () => {
      if (!nextKey) return;
      registry.release(nextKey);
      sessionRefsByAddress.delete(nextKey);
      setHeldKey((current) => (current === nextKey ? null : current));
    };
  }, [nextKey]);

  const snapshot = useSyncExternalStore(
    (onStoreChange) => (session ? session.subscribe(onStoreChange) : () => {}),
    () => {
      // Re-read when held-key flips so enableWalletSignatures stays current.
      void nostrPrivateKey;
      return address && isConnected && session
        ? session.getSnapshot()
        : DISCONNECTED_SNAPSHOT;
    },
    () => DISCONNECTED_SNAPSHOT,
  );

  const client =
    address && isConnected && session ? session.getXmtpClient() : null;

  useEffect(() => {
    if (snapshot.state !== "active") return;
    if (!shouldIdleWarmXmtp({ publiclyReachable: snapshot.publiclyReachable, hasClient: client != null })) {
      return;
    }
    return scheduleIdle(() => {
      void preloadXmtp();
    });
  }, [snapshot, client]);

  const value: MessagingSessionContextValue =
    address && isConnected && session
      ? {
          snapshot,
          dispatch: (command) => {
            session.dispatch(command);
          },
          client,
          session,
        }
      : DISCONNECTED_VALUE;

  return (
    <MessagingSessionContext.Provider value={value}>{children}</MessagingSessionContext.Provider>
  );
}

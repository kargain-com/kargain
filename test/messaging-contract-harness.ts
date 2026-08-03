/**
 * Fake ports + controlled clock for the messaging contract suite.
 * R1 replaces {@link createMessagingSession} with the real factory.
 */

import assert from "node:assert/strict";

import { createMessagingSession } from "../lib/messaging/session-store.ts";

import type {
  BuildLocalResult,
  Clock,
  CreateWithSignerResult,
  InstallationReadout,
  IntentReadResult,
  MessagingWalletKind,
  NostrPolicyPort,
  RevokeAllResult,
  RevokeOtherResult,
  WalletPort,
  XmtpLocalClient,
  XmtpPort,
} from "../lib/messaging/ports.ts";
import { createInMemoryMessagingCache } from "../lib/messaging/adapters/cache-adapter.ts";
import type { CacheEntry } from "../lib/messaging/adapters/cache-adapter.ts";

export type ControlledClock = Clock & {
  advance(ms: number): void;
  /** Flush all sleeps whose due time is ≤ now. */
  flush(): Promise<void>;
};

type SleepWaiter = {
  dueMs: number;
  resolve: () => void;
  reject: (err: Error) => void;
  signal?: AbortSignal;
};

export function createControlledClock(startMs = 0): ControlledClock {
  let now = startMs;
  const waiters: SleepWaiter[] = [];

  function removeWaiter(waiter: SleepWaiter): void {
    const i = waiters.indexOf(waiter);
    if (i >= 0) waiters.splice(i, 1);
  }

  return {
    nowMs() {
      return now;
    },
    advance(ms: number) {
      if (ms < 0) throw new Error("ControlledClock.advance: ms must be ≥ 0");
      now += ms;
    },
    async flush() {
      // Resolve due waiters in waves — a resolve may schedule another sleep.
      for (let wave = 0; wave < 32; wave += 1) {
        const due = waiters
          .filter((w) => w.dueMs <= now)
          .sort((a, b) => a.dueMs - b.dueMs);
        if (due.length === 0) return;
        for (const w of due) {
          removeWaiter(w);
          w.resolve();
        }
        await Promise.resolve();
      }
    },
    sleep(ms: number, signal?: AbortSignal) {
      return new Promise<void>((resolve, reject) => {
        if (signal?.aborted) {
          reject(new DOMException("Aborted", "AbortError"));
          return;
        }
        const waiter: SleepWaiter = {
          dueMs: now + ms,
          resolve: () => resolve(),
          reject,
          signal,
        };
        const onAbort = () => {
          removeWaiter(waiter);
          reject(new DOMException("Aborted", "AbortError"));
        };
        signal?.addEventListener("abort", onAbort, { once: true });
        waiters.push(waiter);
        // Never sync-resolve — even sleep(0) waits for flush (macrotask stand-in).
      });
    },
  };
}

export type FakeXmtpHandlers = {
  buildLocal?: (address: string, signal?: AbortSignal) => Promise<BuildLocalResult>;
  createWithSigner?: (
    address: string,
    signal?: AbortSignal,
  ) => Promise<CreateWithSignerResult>;
  closeLocal?: (client: XmtpLocalClient) => void;
  ensureDurableStorage?: (signal?: AbortSignal) => Promise<{ durable: boolean }>;
  revokeOtherInstallations?: (
    address: string,
    signal?: AbortSignal,
    currentClient?: XmtpLocalClient | null,
  ) => Promise<RevokeOtherResult>;
  revokeAllInstallations?: (
    address: string,
    signal?: AbortSignal,
  ) => Promise<RevokeAllResult>;
  readInstallations?: (
    address: string,
    signal?: AbortSignal,
    currentClient?: XmtpLocalClient | null,
  ) => Promise<InstallationReadout>;
};

export type FakeXmtpPort = XmtpPort & {
  calls: {
    buildLocal: number;
    createWithSigner: number;
    closeLocal: number;
    ensureDurableStorage: number;
    revokeOtherInstallations: number;
    revokeAllInstallations: number;
    readInstallations: number;
  };
  /** Live client handles not yet closed (balance invariant). */
  liveCount: number;
  /** Last currentClient passed to revokeOtherInstallations (for exclude-current asserts). */
  lastRevokeOthersClient: XmtpLocalClient | null | undefined;
};

/** Never-resolving promise (until abort) — hang fixture. */
export function hangUntilAbort<T>(signal?: AbortSignal): Promise<T> {
  return new Promise<T>((_resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    signal?.addEventListener(
      "abort",
      () => reject(new DOMException("Aborted", "AbortError")),
      { once: true },
    );
  });
}

export function createFakeXmtpPort(handlers: FakeXmtpHandlers = {}): FakeXmtpPort {
  const calls = {
    buildLocal: 0,
    createWithSigner: 0,
    closeLocal: 0,
    ensureDurableStorage: 0,
    revokeOtherInstallations: 0,
    revokeAllInstallations: 0,
    readInstallations: 0,
  };
  const live = new Set<XmtpLocalClient>();
  let lastRevokeOthersClient: XmtpLocalClient | null | undefined;
  let clientSeq = 0;

  function trackAcquire(client: XmtpLocalClient): XmtpLocalClient {
    live.add(client);
    return client;
  }

  function defaultClient(): XmtpLocalClient {
    clientSeq += 1;
    return { __brand: "XmtpLocalClient", __id: clientSeq } as XmtpLocalClient;
  }

  return {
    calls,
    get liveCount() {
      return live.size;
    },
    get lastRevokeOthersClient() {
      return lastRevokeOthersClient;
    },
    async buildLocal(address, signal) {
      calls.buildLocal += 1;
      if (handlers.buildLocal) {
        const result = await handlers.buildLocal(address, signal);
        if (result.ok) trackAcquire(result.client);
        return result;
      }
      return { ok: false, reason: "not_registered" };
    },
    async createWithSigner(address, signal) {
      calls.createWithSigner += 1;
      if (handlers.createWithSigner) {
        const result = await handlers.createWithSigner(address, signal);
        if (result.ok) trackAcquire(result.client);
        return result;
      }
      return { ok: true, client: trackAcquire(defaultClient()) };
    },
    closeLocal(client) {
      calls.closeLocal += 1;
      live.delete(client);
      if (handlers.closeLocal) handlers.closeLocal(client);
    },
    async ensureDurableStorage(signal) {
      calls.ensureDurableStorage += 1;
      if (handlers.ensureDurableStorage) return handlers.ensureDurableStorage(signal);
      return { durable: true };
    },
    async revokeOtherInstallations(address, signal, currentClient) {
      calls.revokeOtherInstallations += 1;
      lastRevokeOthersClient = currentClient;
      if (handlers.revokeOtherInstallations) {
        return handlers.revokeOtherInstallations(address, signal, currentClient);
      }
      if (!currentClient) return { ok: false, reason: "no_current_installation" };
      return { ok: true };
    },
    async revokeAllInstallations(address, signal) {
      calls.revokeAllInstallations += 1;
      if (handlers.revokeAllInstallations) {
        return handlers.revokeAllInstallations(address, signal);
      }
      return { ok: true };
    },
    async readInstallations(address, signal, currentClient) {
      calls.readInstallations += 1;
      if (handlers.readInstallations) {
        return handlers.readInstallations(address, signal, currentClient);
      }
      return { installations: [], currentInstallationId: null };
    },
  };
}

export type FakeNostrHandlers = {
  readIntent?: (
    address: string,
    signal?: AbortSignal,
  ) => Promise<IntentReadResult>;
  publishIntent?: (
    address: string,
    enabled: boolean,
    signal?: AbortSignal,
  ) => Promise<
    { ok: true } | { ok: false; reason: "publish_failed" | "signature_declined" }
  >;
  isKeyHeld?: () => boolean;
  getAttestationValidCached?: () => boolean | null;
  probeAttestationValid?: (address: string) => Promise<boolean>;
};

export type FakeNostrPolicyPort = NostrPolicyPort & {
  calls: { readIntent: number; publishIntent: number };
  /** Ordered publish calls for disable-ordering assertions. */
  publishLog: Array<{ enabled: boolean }>;
  setKeyHeld(held: boolean): void;
  setAttestationValid(valid: boolean | null): void;
};

export function answeredIntent(intent: true | false | null): IntentReadResult {
  return { status: "answered", intent };
}

export function unansweredIntent(): IntentReadResult {
  return { status: "unanswered" };
}

export function createFakeNostrPolicyPort(
  handlers: FakeNostrHandlers = {},
): FakeNostrPolicyPort {
  const calls = { readIntent: 0, publishIntent: 0 };
  const publishLog: Array<{ enabled: boolean }> = [];
  let keyHeld = false;
  let attestationValid: boolean | null = null;

  return {
    calls,
    publishLog,
    setKeyHeld(held) {
      keyHeld = held;
    },
    setAttestationValid(valid) {
      attestationValid = valid;
    },
    async readIntent(address, signal) {
      calls.readIntent += 1;
      if (handlers.readIntent) return handlers.readIntent(address, signal);
      return answeredIntent(null);
    },
    async publishIntent(address, enabled, signal) {
      calls.publishIntent += 1;
      publishLog.push({ enabled });
      if (handlers.publishIntent) return handlers.publishIntent(address, enabled, signal);
      return { ok: true };
    },
    isKeyHeld() {
      return handlers.isKeyHeld?.() ?? keyHeld;
    },
    getAttestationValidCached() {
      return handlers.getAttestationValidCached?.() ?? attestationValid;
    },
    async probeAttestationValid(address) {
      if (handlers.probeAttestationValid) {
        const valid = await handlers.probeAttestationValid(address);
        attestationValid = valid;
        return valid;
      }
      if (attestationValid === null) attestationValid = false;
      return attestationValid === true;
    },
  };
}

export type FakeWalletState = {
  address: string | null;
  kind: MessagingWalletKind | null;
};

export type FakeWalletPort = WalletPort & {
  setAddress(address: string | null): void;
  setKind(kind: MessagingWalletKind | null): void;
  calls: { waitUntilReady: number };
};

export function createFakeWalletPort(
  initial: FakeWalletState = {
    address: "0x1111111111111111111111111111111111111111",
    kind: "eoa",
  },
): FakeWalletPort {
  let address = initial.address;
  let kind = initial.kind;
  const calls = { waitUntilReady: 0 };

  return {
    calls,
    getAddress() {
      return address;
    },
    getAccountKind() {
      return kind;
    },
    async ensureAccountKindProbed() {
      if (address && !kind) kind = "eoa";
    },
    setAddress(next) {
      address = next;
    },
    setKind(next) {
      kind = next;
    },
    async waitUntilReady(signal) {
      calls.waitUntilReady += 1;
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    },
  };
}

const TEST_ADDRESS = "0x1111111111111111111111111111111111111111";

type OpenSessionHandle = {
  session: ReturnType<typeof createMessagingSession>;
  xmtp: FakeXmtpPort;
  nostr: FakeNostrPolicyPort;
  wallet: FakeWalletPort;
  clock: ControlledClock;
  cache: ReturnType<typeof createInMemoryMessagingCache>;
};

const openSessionHandles: OpenSessionHandle[] = [];

/** Teardown invariant — every openSession must leave zero live XMTP clients. */
export async function disposeAllOpenSessions(): Promise<void> {
  const handles = openSessionHandles.splice(0);
  for (const handle of handles) {
    handle.session.dispose();
    await settleAsync(handle.clock);
    assert.equal(
      handle.xmtp.liveCount,
      0,
      "live-client balance: every acquired client must be closed at teardown",
    );
  }
}

export async function settleAsync(clock: ControlledClock, rounds = 40): Promise<void> {
  for (let i = 0; i < rounds; i += 1) {
    await clock.flush();
    await Promise.resolve();
    await Promise.resolve();
  }
}

/** Advance wall clock and flush deadline sleeps so hung probes/builds settle. */
export async function advanceAndSettle(
  clock: ControlledClock,
  ms: number,
): Promise<void> {
  await settleAsync(clock);
  clock.advance(ms);
  await settleAsync(clock);
}

export function openSession(
  clock: ControlledClock,
  handlers: {
    xmtp?: Parameters<typeof createFakeXmtpPort>[0];
    nostr?: Parameters<typeof createFakeNostrPolicyPort>[0];
    wallet?: Parameters<typeof createFakeWalletPort>[0];
    cacheSeed?: Partial<CacheEntry>;
    env?: string;
  } = {},
  opts: { demand?: boolean } = {},
): OpenSessionHandle {
  const xmtp = createFakeXmtpPort(handlers.xmtp);
  const nostr = createFakeNostrPolicyPort(handlers.nostr);
  const wallet = createFakeWalletPort(handlers.wallet);
  const cache = createInMemoryMessagingCache();
  if (handlers.cacheSeed) {
    cache.set(TEST_ADDRESS, handlers.cacheSeed);
  }
  const session = createMessagingSession({
    address: TEST_ADDRESS,
    ports: { xmtp, nostr, wallet },
    clock,
    cache,
  });
  void handlers.env;
  session.start();
  // Most contract surfaces need a local client (build). Opt out for dormant cases.
  if (opts.demand !== false) {
    session.requestLocalClient();
  }
  const handle = { session, xmtp, nostr, wallet, clock, cache };
  openSessionHandles.push(handle);
  return handle;
}

export { createMessagingSession, TEST_ADDRESS };

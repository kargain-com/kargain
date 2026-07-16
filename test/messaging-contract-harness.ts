/**
 * Fake ports + controlled clock for the messaging contract suite.
 * R1 replaces {@link createMessagingSession} with the real factory.
 */

import { createMessagingSession } from "../lib/messaging/session-store.ts";

import type {
  BuildLocalResult,
  Clock,
  CreateWithSignerResult,
  MessagingWalletKind,
  NostrPolicyPort,
  ProbeRegistrationResult,
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
        if (waiter.dueMs <= now) {
          removeWaiter(waiter);
          signal?.removeEventListener("abort", onAbort);
          resolve();
        }
      });
    },
  };
}

export type FakeXmtpHandlers = {
  probeRegistration?: (
    address: string,
    signal?: AbortSignal,
  ) => Promise<ProbeRegistrationResult>;
  buildLocal?: (address: string, signal?: AbortSignal) => Promise<BuildLocalResult>;
  createWithSigner?: (
    address: string,
    signal?: AbortSignal,
  ) => Promise<CreateWithSignerResult>;
  revokeInstallations?: (address: string, signal?: AbortSignal) => Promise<void>;
  resetLocalDb?: (address: string) => Promise<void>;
};

export type FakeXmtpPort = XmtpPort & {
  calls: {
    probeRegistration: number;
    buildLocal: number;
    createWithSigner: number;
    revokeInstallations: number;
    resetLocalDb: number;
  };
};

const fakeClient = { __brand: "XmtpLocalClient" as const } satisfies XmtpLocalClient;

/** Never-resolving promise (until abort) — July 16 hang fixture. */
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
    probeRegistration: 0,
    buildLocal: 0,
    createWithSigner: 0,
    revokeInstallations: 0,
    resetLocalDb: 0,
  };

  return {
    calls,
    async probeRegistration(address, signal) {
      calls.probeRegistration += 1;
      if (handlers.probeRegistration) return handlers.probeRegistration(address, signal);
      return { registered: false };
    },
    async buildLocal(address, signal) {
      calls.buildLocal += 1;
      if (handlers.buildLocal) return handlers.buildLocal(address, signal);
      return { ok: false, reason: "not_registered" };
    },
    async createWithSigner(address, signal) {
      calls.createWithSigner += 1;
      if (handlers.createWithSigner) return handlers.createWithSigner(address, signal);
      return { ok: true, client: fakeClient };
    },
    async revokeInstallations(address, signal) {
      calls.revokeInstallations += 1;
      if (handlers.revokeInstallations) {
        await handlers.revokeInstallations(address, signal);
      }
    },
    async resetLocalDb(address) {
      calls.resetLocalDb += 1;
      if (handlers.resetLocalDb) await handlers.resetLocalDb(address);
    },
  };
}

export type FakeNostrHandlers = {
  readIntent?: (address: string, signal?: AbortSignal) => Promise<boolean | null>;
  publishIntent?: (
    address: string,
    enabled: boolean,
    signal?: AbortSignal,
  ) => Promise<{ ok: true } | { ok: false; reason: "publish_failed" }>;
};

export type FakeNostrPolicyPort = NostrPolicyPort & {
  calls: { readIntent: number; publishIntent: number };
  /** Ordered publish calls for disable-ordering assertions. */
  publishLog: Array<{ enabled: boolean }>;
};

export function createFakeNostrPolicyPort(
  handlers: FakeNostrHandlers = {},
): FakeNostrPolicyPort {
  const calls = { readIntent: 0, publishIntent: 0 };
  const publishLog: Array<{ enabled: boolean }> = [];

  return {
    calls,
    publishLog,
    async readIntent(address, signal) {
      calls.readIntent += 1;
      if (handlers.readIntent) return handlers.readIntent(address, signal);
      return null;
    },
    async publishIntent(address, enabled, signal) {
      calls.publishIntent += 1;
      publishLog.push({ enabled });
      if (handlers.publishIntent) return handlers.publishIntent(address, enabled, signal);
      return { ok: true };
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
  } = {},
) {
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
  return { session, xmtp, nostr, wallet, clock, cache };
}

export { createMessagingSession };

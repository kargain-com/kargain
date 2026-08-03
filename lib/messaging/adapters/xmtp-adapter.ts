"use client";

/**
 * Sole runtime entry for @xmtp/client — dynamic import only (see loadXmtp).
 * ESLint no-restricted-imports is disabled for this file only.
 */

import type {
  AsyncStreamProxy,
  Client,
  ClientOptions,
  DecodedMessage,
  InboxState,
  Signer,
  XmtpEnv,
} from "@xmtp/client";
import { getAddress, hexToBytes, type WalletClient } from "viem";

import type {
  BuildLocalResult,
  CreateWithSignerResult,
  DurableStorageResult,
  InstallationReadout,
  RevokeAllResult,
  RevokeOtherResult,
  XmtpLocalClient,
  XmtpPort,
} from "../ports";
import { getMessagingXmtpEnv } from "../xmtp-env";

type XmtpModule = typeof import("@xmtp/client");

let xmtpModulePromise: Promise<XmtpModule> | null = null;
let xmtpModule: XmtpModule | null = null;
/** Test-only: increments on every `loadXmtp` entry (including cache hits). */
let xmtpLoadInvocationCount = 0;

async function loadXmtp(): Promise<XmtpModule> {
  xmtpLoadInvocationCount += 1;
  if (xmtpModule) return xmtpModule;
  xmtpModulePromise ??= import("@xmtp/client").then((mod) => {
    xmtpModule = mod;
    return mod;
  });
  return xmtpModulePromise;
}

/** Idle warm — load the SDK module only; does not build a client. */
export function preloadXmtp(): Promise<XmtpModule> {
  return loadXmtp();
}

/** Same readiness path as the session port `ensureModule` — no second loader. */
export async function ensureXmtpModuleReady(signal?: AbortSignal): Promise<void> {
  await ensureModuleLoaded(signal);
}

export function isXmtpModuleReady(): boolean {
  return xmtpModule != null;
}

/** @internal tests — loader invocation count (browse must stay at zero). */
export function __testGetXmtpLoadInvocationCount(): number {
  return xmtpLoadInvocationCount;
}

function ensureXmtpModule(): XmtpModule {
  if (!xmtpModule) {
    throw new Error("XMTP SDK is not loaded yet");
  }
  return xmtpModule;
}

const INSTALLATION_LIMIT_PREFIX =
  "Cannot register a new installation because the InboxID";
const INSTALLATION_LIMIT_SUFFIX = "Please revoke existing installations first";

const APP_VERSION = "kargain-app/1.x";

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function isOpfsLockError(error: unknown): boolean {
  if (xmtpModule) {
    const { OpfsInitializationError, OpfsNotInitializedError } = xmtpModule;
    if (error instanceof OpfsInitializationError || error instanceof OpfsNotInitializedError) {
      return true;
    }
  }
  if (error instanceof Error) {
    const { name, message } = error;
    if (name === "OpfsInitializationError" || name === "OpfsNotInitializedError") {
      return true;
    }
    // Same-tab orphan / SyncAccessHandle contention often surfaces as these strings.
    const lower = message.toLowerCase();
    if (
      lower.includes("opfs") ||
      lower.includes("syncaccesshandle") ||
      lower.includes("access handle") ||
      lower.includes("database is locked")
    ) {
      return true;
    }
  }
  return false;
}

async function ensureModuleLoaded(signal?: AbortSignal): Promise<XmtpModule> {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  if (xmtpModule) return xmtpModule;
  const load = loadXmtp();
  if (!signal) return load;
  return Promise.race([
    load,
    new Promise<XmtpModule>((_resolve, reject) => {
      const onAbort = () => {
        signal.removeEventListener("abort", onAbort);
        reject(new DOMException("Aborted", "AbortError"));
      };
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener("abort", onAbort, { once: true });
    }),
  ]);
}

function classifyCreateError(error: unknown): CreateWithSignerResult {
  const message =
    error instanceof Error ? error.message : typeof error === "string" ? error : "";
  if (
    message.includes(INSTALLATION_LIMIT_PREFIX) &&
    message.includes(INSTALLATION_LIMIT_SUFFIX)
  ) {
    return { ok: false, reason: "installation_limit" };
  }
  if (isOpfsLockError(error)) {
    return { ok: false, reason: "opfs_lock" };
  }
  if (error instanceof DOMException && error.name === "AbortError") {
    return { ok: false, reason: "create_cancelled" };
  }
  return { ok: false, reason: "build_failed" };
}

function ethereumIdentifier(address: `0x${string}`, IdentifierKind: XmtpModule["IdentifierKind"]) {
  const addr = getAddress(address);
  return {
    identifier: addr.toLowerCase(),
    identifierKind: IdentifierKind.Ethereum,
  };
}

function clientOptions(): ClientOptions {
  return {
    env: getMessagingXmtpEnv() as XmtpEnv,
    appVersion: APP_VERSION,
  };
}

function asBrand(client: Client<unknown>): XmtpLocalClient {
  return client as unknown as XmtpLocalClient;
}

export function unbrandClient(client: XmtpLocalClient): Client<unknown> {
  return client as unknown as Client<unknown>;
}

export type XmtpSdkClient = Client<unknown>;

export function isText(message: DecodedMessage<unknown>): boolean {
  return ensureXmtpModule().isText(message);
}

export function messageText(message: DecodedMessage<unknown>): string {
  if (isText(message)) return String(message.content ?? "");
  return message.fallback ?? "…";
}

export function getClientEthereumAddress(client: XmtpSdkClient): `0x${string}` | null {
  const identifier = client.accountIdentifier;
  if (!identifier) return null;
  const ethKind = xmtpModule?.IdentifierKind.Ethereum;
  if (ethKind !== undefined && identifier.identifierKind !== ethKind) return null;
  try {
    return getAddress(identifier.identifier as `0x${string}`);
  } catch {
    return null;
  }
}

export function ethereumAddressFromInboxState(
  state: { accountIdentifiers: Array<{ identifier: string; identifierKind: number }> } | undefined,
): `0x${string}` | null {
  if (!state) return null;
  const ethKind = xmtpModule?.IdentifierKind.Ethereum;
  const eth = state.accountIdentifiers.find(
    (id) => (ethKind === undefined || id.identifierKind === ethKind) && id.identifier.startsWith("0x"),
  );
  if (!eth) return null;
  try {
    return getAddress(eth.identifier as `0x${string}`);
  } catch {
    return null;
  }
}

export function truncatePreview(text: string, max = 60): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1)}…`;
}

export function dateToSentAfterNs(date: Date): bigint {
  return BigInt(date.getTime()) * 1_000_000n;
}

/** Endable stream handle owned by the adapter registry. */
type RegisteredStream = {
  end: () => Promise<void>;
};

const streamsByClient = new Map<object, Set<RegisteredStream>>();
let liveInboxStreamCount = 0;

/** Test/teardown invariant — inbox delivery streams still open. */
export function getLiveInboxStreamCount(): number {
  return liveInboxStreamCount;
}

function registerClientStream(client: object, stream: RegisteredStream): void {
  let set = streamsByClient.get(client);
  if (!set) {
    set = new Set();
    streamsByClient.set(client, set);
  }
  set.add(stream);
  liveInboxStreamCount += 1;
}

function unregisterClientStream(client: object, stream: RegisteredStream): void {
  const set = streamsByClient.get(client);
  if (!set || !set.has(stream)) return;
  set.delete(stream);
  liveInboxStreamCount = Math.max(0, liveInboxStreamCount - 1);
  if (set.size === 0) streamsByClient.delete(client);
}

async function endAllStreamsForClient(client: object): Promise<void> {
  const set = streamsByClient.get(client);
  if (!set) return;
  streamsByClient.delete(client);
  const streams = [...set];
  set.clear();
  await Promise.all(
    streams.map(async (stream) => {
      try {
        await stream.end();
      } catch {
        // Teardown must not fail closeLocal.
      }
      liveInboxStreamCount = Math.max(0, liveInboxStreamCount - 1);
    }),
  );
}

export type InboxDeliveryHandlers = {
  onConversation: () => void;
  onMessage: (conversationId: string) => void;
  /** Fired at most once per handle when a stream fails or errors. */
  onFail: () => void;
};

export type InboxDeliveryHandle = {
  end: () => Promise<void>;
};

/**
 * Open DM conversation + all-DM-message streams for inbox delivery.
 * Consent filter omitted so behaviour matches unfiltered `listDms()` (P9 owns Allowed).
 * Streams are registered against `client` and ended by `closeLocal` / `handle.end()`.
 */
export async function openInboxDeliveryStreams(
  client: XmtpSdkClient,
  handlers: InboxDeliveryHandlers,
): Promise<InboxDeliveryHandle> {
  let failed = false;
  let ended = false;
  const failOnce = () => {
    if (failed || ended) return;
    failed = true;
    handlers.onFail();
  };

  const dmStream = await client.conversations.streamDms({
    onValue: () => {
      if (ended) return;
      handlers.onConversation();
    },
    onFail: failOnce,
    onError: failOnce,
  });

  const msgStream = await client.conversations.streamAllDmMessages({
    onValue: (message) => {
      if (ended) return;
      handlers.onMessage(message.conversationId);
    },
    onFail: failOnce,
    onError: failOnce,
  });

  const registered: RegisteredStream[] = [
    {
      end: async () => {
        await dmStream.end();
      },
    },
    {
      end: async () => {
        await msgStream.end();
      },
    },
  ];
  for (const stream of registered) {
    registerClientStream(client, stream);
  }

  return {
    async end() {
      if (ended) return;
      ended = true;
      for (const stream of registered) {
        unregisterClientStream(client, stream);
        try {
          await stream.end();
        } catch {
          // Idempotent end.
        }
      }
    },
  };
}

/**
 * Protocol read receipt. Does not touch localStorage.
 * Returns ok:false when the conversation is missing or the send fails.
 */
export async function markConversationRead(
  client: XmtpSdkClient,
  conversationId: string,
): Promise<{ ok: true } | { ok: false }> {
  try {
    const conversation = await client.conversations.getConversationById(conversationId);
    if (!conversation) return { ok: false };
    await conversation.sendReadReceipt();
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

export async function openDmWithPeer(
  client: XmtpSdkClient,
  peerAddress: `0x${string}`,
) {
  const xmtp = ensureXmtpModule();
  const peer = getAddress(peerAddress);
  return client.conversations.createDmWithIdentifier(
    ethereumIdentifier(peer, xmtp.IdentifierKind),
  );
}

export type XmtpDm = Awaited<ReturnType<typeof openDmWithPeer>>;

/** Sort direction enum — requires SDK load before first read. */
export const SortDirection = {
  get Ascending() {
    return ensureXmtpModule().SortDirection.Ascending;
  },
  get Descending() {
    return ensureXmtpModule().SortDirection.Descending;
  },
};

export type { AsyncStreamProxy, DecodedMessage };

export function buildXmtpEoaSigner(
  walletClient: WalletClient,
  address: `0x${string}`,
  IdentifierKind: XmtpModule["IdentifierKind"],
): Signer {
  return {
    type: "EOA",
    getIdentifier: () => ethereumIdentifier(address, IdentifierKind),
    signMessage: async (message: string) => {
      const hex = await walletClient.signMessage({
        account: address,
        message,
      });
      return hexToBytes(hex);
    },
  };
}

export async function resolveInboxId(address: `0x${string}`): Promise<string> {
  const xmtp = ensureXmtpModule();
  const identifier = ethereumIdentifier(address, xmtp.IdentifierKind);
  const env = getMessagingXmtpEnv() as XmtpEnv;
  try {
    const backend = await xmtp.createBackend({ env });
    const networkInboxId = await xmtp.getInboxIdForIdentifier(backend, identifier);
    if (networkInboxId) return networkInboxId;
  } catch {
    // Network lookup failed — fall back to local derivation.
  }
  return xmtp.generateInboxId(identifier);
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function nsToCreatedAtMs(ns: bigint | undefined): number | null {
  if (ns === undefined) return null;
  return Number(ns / 1_000_000n);
}

async function messagingBackend() {
  const xmtp = ensureXmtpModule();
  const env = getMessagingXmtpEnv() as XmtpEnv;
  return { xmtp, backend: await xmtp.createBackend({ env }) };
}

function mapInstallationReadout(
  state: InboxState | undefined,
  currentClient: XmtpLocalClient | null | undefined,
): InstallationReadout {
  const current = currentClient ? unbrandClient(currentClient) : null;
  const currentId = current?.installationId ?? null;
  const installations = (state?.installations ?? []).map((installation) => ({
    id: installation.id,
    createdAtMs: nsToCreatedAtMs(installation.clientTimestampNs),
  }));
  return { installations, currentInstallationId: currentId };
}

export type CreateXmtpAdapterInput = {
  getWalletClient: () => WalletClient | undefined;
};

/**
 * Network registration probe — assumes the SDK module is already ready.
 * Does not load the module; callers must `ensureXmtpModuleReady` first.
 */
export async function probePeerRegistration(
  address: string,
  signal?: AbortSignal,
): Promise<{ registered: boolean }> {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  const xmtp = ensureXmtpModule();
  const env = getMessagingXmtpEnv() as XmtpEnv;
  const backend = await xmtp.createBackend({ env });
  const peer = getAddress(address as `0x${string}`);
  const identifier = ethereumIdentifier(peer, xmtp.IdentifierKind);
  const response = await xmtp.Client.canMessage([identifier], backend);
  const registered = response.get(identifier.identifier) === true;
  return { registered };
}

export function createXmtpAdapter(input: CreateXmtpAdapterInput): XmtpPort {
  return {
    async ensureModule(signal) {
      await ensureModuleLoaded(signal);
    },

    isModuleReady() {
      return xmtpModule != null;
    },

    async buildLocal(address, signal) {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      try {
        const xmtp = ensureXmtpModule();
        const peer = getAddress(address as `0x${string}`);
        const client = await xmtp.Client.build(
          ethereumIdentifier(peer, xmtp.IdentifierKind),
          clientOptions(),
        );
        if (signal?.aborted) {
          try {
            client.close();
          } catch {
            // ignore
          }
          throw new DOMException("Aborted", "AbortError");
        }
        const registered = await client.isRegistered();
        if (!registered) {
          client.close();
          return { ok: false, reason: "not_registered" } satisfies BuildLocalResult;
        }
        return { ok: true, client: asBrand(client) } satisfies BuildLocalResult;
      } catch (error) {
        if (isAbortError(error)) throw error;
        if (isOpfsLockError(error)) {
          return { ok: false, reason: "opfs_lock" };
        }
        return { ok: false, reason: "build_failed" };
      }
    },

    async createWithSigner(address, signal) {
      const walletClient = input.getWalletClient();
      if (!walletClient) {
        return { ok: false, reason: "build_failed" };
      }
      try {
        const xmtp = ensureXmtpModule();
        const peer = getAddress(address as `0x${string}`);
        const signer = buildXmtpEoaSigner(walletClient, peer, xmtp.IdentifierKind);
        const client = await xmtp.Client.create(signer, clientOptions());
        if (signal?.aborted) {
          client.close();
          return { ok: false, reason: "create_cancelled" };
        }
        return { ok: true, client: asBrand(client) } satisfies CreateWithSignerResult;
      } catch (error) {
        return classifyCreateError(error);
      }
    },

    closeLocal(client) {
      const raw = unbrandClient(client);
      void endAllStreamsForClient(raw).finally(() => {
        try {
          raw.close();
        } catch {
          // Already shut down or worker dead — teardown must not fail the session.
        }
      });
    },

    async ensureDurableStorage(signal) {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      try {
        const storage = globalThis.navigator?.storage;
        if (!storage || typeof storage.persist !== "function") {
          return { durable: false } satisfies DurableStorageResult;
        }
        const durable = await storage.persist();
        return { durable } satisfies DurableStorageResult;
      } catch {
        return { durable: false } satisfies DurableStorageResult;
      }
    },

    async revokeOtherInstallations(address, signal, currentClient) {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      if (!currentClient) {
        return { ok: false, reason: "no_current_installation" } satisfies RevokeOtherResult;
      }
      const client = unbrandClient(currentClient);
      const xmtp = ensureXmtpModule();
      try {
        await client.revokeAllOtherInstallations();
        return { ok: true } satisfies RevokeOtherResult;
      } catch (error) {
        if (!(error instanceof xmtp.SignerUnavailableError)) throw error;
      }
      const currentBytes = client.installationIdBytes;
      if (!currentBytes) {
        return { ok: false, reason: "no_current_installation" } satisfies RevokeOtherResult;
      }
      const walletClient = input.getWalletClient();
      if (!walletClient) {
        return { ok: false, reason: "no_current_installation" } satisfies RevokeOtherResult;
      }
      const peer = getAddress(address as `0x${string}`);
      const signer = buildXmtpEoaSigner(walletClient, peer, xmtp.IdentifierKind);
      const { backend } = await messagingBackend();
      const inboxId = await resolveInboxId(peer);
      const states = await xmtp.Client.fetchInboxStates([inboxId], backend);
      const others = (states[0]?.installations ?? [])
        .filter((installation) => !bytesEqual(installation.bytes, currentBytes))
        .map((installation) => installation.bytes);
      if (others.length === 0) return { ok: true } satisfies RevokeOtherResult;
      await xmtp.Client.revokeInstallations(signer, inboxId, others, backend);
      return { ok: true } satisfies RevokeOtherResult;
    },

    async revokeAllInstallations(address, signal) {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      const walletClient = input.getWalletClient();
      if (!walletClient) return { ok: true } satisfies RevokeAllResult;
      const { xmtp, backend } = await messagingBackend();
      const peer = getAddress(address as `0x${string}`);
      const signer = buildXmtpEoaSigner(walletClient, peer, xmtp.IdentifierKind);
      const inboxId = await resolveInboxId(peer);
      const states = await xmtp.Client.fetchInboxStates([inboxId], backend);
      const installationIds = (states[0]?.installations ?? []).map(
        (installation) => installation.bytes,
      );
      if (installationIds.length === 0) return { ok: true } satisfies RevokeAllResult;
      await xmtp.Client.revokeInstallations(signer, inboxId, installationIds, backend);
      return { ok: true } satisfies RevokeAllResult;
    },

    async readInstallations(address, signal, currentClient) {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      const { xmtp, backend } = await messagingBackend();
      const peer = getAddress(address as `0x${string}`);
      const inboxId = await resolveInboxId(peer);
      const states = await xmtp.Client.fetchInboxStates([inboxId], backend);
      return mapInstallationReadout(states[0], currentClient);
    },
  };
}

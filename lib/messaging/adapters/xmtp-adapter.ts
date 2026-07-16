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
  ProbeRegistrationResult,
  XmtpLocalClient,
  XmtpPort,
} from "../ports";
import { getMessagingXmtpEnv } from "../xmtp-env";

type XmtpModule = typeof import("@xmtp/client");

let xmtpModulePromise: Promise<XmtpModule> | null = null;
let xmtpModule: XmtpModule | null = null;

async function loadXmtp(): Promise<XmtpModule> {
  if (xmtpModule) return xmtpModule;
  xmtpModulePromise ??= import("@xmtp/client").then((mod) => {
    xmtpModule = mod;
    return mod;
  });
  return xmtpModulePromise;
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

function isOpfsLockError(error: unknown): boolean {
  if (xmtpModule) {
    const { OpfsInitializationError, OpfsNotInitializedError } = xmtpModule;
    if (error instanceof OpfsInitializationError || error instanceof OpfsNotInitializedError) {
      return true;
    }
  }
  if (error instanceof Error) {
    const { name } = error;
    if (name === "OpfsInitializationError" || name === "OpfsNotInitializedError") {
      return true;
    }
  }
  return false;
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

export async function openDmWithPeer(
  client: XmtpSdkClient,
  peerAddress: `0x${string}`,
) {
  const xmtp = await loadXmtp();
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

export function xmtpDatabaseFilename(env: XmtpEnv, inboxId: string): string {
  return `xmtp-${env}-${inboxId}.db3`;
}

export function installationIdBytesFromInboxState(
  state: InboxState | undefined,
): Uint8Array[] {
  if (!state) return [];
  return state.installations.map((installation) => installation.bytes);
}

export async function resolveInboxId(address: `0x${string}`): Promise<string> {
  const xmtp = await loadXmtp();
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

function matchesInboxDatabaseFile(path: string, env: XmtpEnv, inboxId: string): boolean {
  return path === xmtpDatabaseFilename(env, inboxId);
}

export type CreateXmtpAdapterInput = {
  getWalletClient: () => WalletClient | undefined;
};

export async function probePeerRegistration(
  address: string,
  signal?: AbortSignal,
): Promise<ProbeRegistrationResult> {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  const xmtp = await loadXmtp();
  const peer = getAddress(address as `0x${string}`);
  const identifier = ethereumIdentifier(peer, xmtp.IdentifierKind);
  const response = await xmtp.Client.canMessage([identifier], getMessagingXmtpEnv() as XmtpEnv);
  const registered = response.get(identifier.identifier) === true;
  return { registered };
}

export function createXmtpAdapter(input: CreateXmtpAdapterInput): XmtpPort {
  return {
    async probeRegistration(address, signal) {
      return probePeerRegistration(address, signal);
    },

    async buildLocal(address, signal) {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      try {
        const xmtp = await loadXmtp();
        const peer = getAddress(address as `0x${string}`);
        const client = await xmtp.Client.build(
          ethereumIdentifier(peer, xmtp.IdentifierKind),
          clientOptions(),
        );
        const registered = await client.isRegistered();
        if (!registered) {
          client.close();
          return { ok: false, reason: "not_registered" } satisfies BuildLocalResult;
        }
        return { ok: true, client: asBrand(client) } satisfies BuildLocalResult;
      } catch (error) {
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
        const xmtp = await loadXmtp();
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

    async revokeInstallations(address, signal) {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      const walletClient = input.getWalletClient();
      if (!walletClient) return;
      const xmtp = await loadXmtp();
      const peer = getAddress(address as `0x${string}`);
      const signer = buildXmtpEoaSigner(walletClient, peer, xmtp.IdentifierKind);
      const env = getMessagingXmtpEnv() as XmtpEnv;
      const inboxId = await resolveInboxId(peer);
      const states = await xmtp.Client.fetchInboxStates([inboxId], env);
      const installationIds = installationIdBytesFromInboxState(states[0]);
      if (installationIds.length === 0) return;
      await xmtp.Client.revokeInstallations(signer, inboxId, installationIds, env);
    },

    async resetLocalDb(address) {
      const xmtp = await loadXmtp();
      const peer = getAddress(address as `0x${string}`);
      const env = getMessagingXmtpEnv() as XmtpEnv;
      const inboxId = await resolveInboxId(peer);
      const opfs = await xmtp.Opfs.create();
      try {
        const files = await opfs.listFiles();
        for (const path of files) {
          if (matchesInboxDatabaseFile(path, env, inboxId)) {
            await opfs.deleteFile(path);
          }
        }
      } finally {
        opfs.close();
      }
    },
  };
}

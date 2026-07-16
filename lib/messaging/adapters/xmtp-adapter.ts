"use client";

import {
  Client,
  createBackend,
  generateInboxId,
  getInboxIdForIdentifier,
  IdentifierKind,
  Opfs,
  OpfsInitializationError,
  OpfsNotInitializedError,
  type ClientOptions,
  type InboxState,
  type Signer,
  type XmtpEnv,
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

const INSTALLATION_LIMIT_PREFIX =
  "Cannot register a new installation because the InboxID";
const INSTALLATION_LIMIT_SUFFIX = "Please revoke existing installations first";

const APP_VERSION = "kargain-app/1.x";

function isOpfsLockError(error: unknown): boolean {
  if (error instanceof OpfsInitializationError || error instanceof OpfsNotInitializedError) {
    return true;
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

function ethereumIdentifier(address: `0x${string}`) {
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

export function buildXmtpEoaSigner(
  walletClient: WalletClient,
  address: `0x${string}`,
): Signer {
  return {
    type: "EOA",
    getIdentifier: () => ethereumIdentifier(address),
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
  const identifier = ethereumIdentifier(address);
  const env = getMessagingXmtpEnv() as XmtpEnv;
  try {
    const backend = await createBackend({ env });
    const networkInboxId = await getInboxIdForIdentifier(backend, identifier);
    if (networkInboxId) return networkInboxId;
  } catch {
    // Network lookup failed — fall back to local derivation.
  }
  return generateInboxId(identifier);
}

function matchesInboxDatabaseFile(path: string, env: XmtpEnv, inboxId: string): boolean {
  return path === xmtpDatabaseFilename(env, inboxId);
}

export type CreateXmtpAdapterInput = {
  getWalletClient: () => WalletClient | undefined;
};

export function createXmtpAdapter(input: CreateXmtpAdapterInput): XmtpPort {
  return {
    async probeRegistration(address, signal) {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      const peer = getAddress(address as `0x${string}`);
      const identifier = ethereumIdentifier(peer);
      const response = await Client.canMessage([identifier], getMessagingXmtpEnv() as XmtpEnv);
      const registered = response.get(identifier.identifier) === true;
      return { registered } satisfies ProbeRegistrationResult;
    },

    async buildLocal(address, signal) {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      try {
        const peer = getAddress(address as `0x${string}`);
        const client = await Client.build(ethereumIdentifier(peer), clientOptions());
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
        const peer = getAddress(address as `0x${string}`);
        const signer = buildXmtpEoaSigner(walletClient, peer);
        const client = await Client.create(signer, clientOptions());
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
      const peer = getAddress(address as `0x${string}`);
      const signer = buildXmtpEoaSigner(walletClient, peer);
      const env = getMessagingXmtpEnv() as XmtpEnv;
      const inboxId = await resolveInboxId(peer);
      const states = await Client.fetchInboxStates([inboxId], env);
      const installationIds = installationIdBytesFromInboxState(states[0]);
      if (installationIds.length === 0) return;
      await Client.revokeInstallations(signer, inboxId, installationIds, env);
    },

    async resetLocalDb(address) {
      const peer = getAddress(address as `0x${string}`);
      const env = getMessagingXmtpEnv() as XmtpEnv;
      const inboxId = await resolveInboxId(peer);
      const opfs = await Opfs.create();
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

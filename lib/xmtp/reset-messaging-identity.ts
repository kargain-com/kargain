"use client";

import {
  Client,
  createBackend,
  generateInboxId,
  getInboxIdForIdentifier,
  Opfs,
  type InboxState,
  type Signer,
  type XmtpEnv,
} from "@xmtp/client";

import { ethereumIdentifier, getXmtpEnv } from "@/lib/xmtp/client";

export type XmtpCreateErrorKind = "installation_limit" | "other";

export type ResolveInboxIdDeps = {
  createBackend?: typeof createBackend;
  getInboxIdForIdentifier?: typeof getInboxIdForIdentifier;
  generateInboxId?: typeof generateInboxId;
};

const INSTALLATION_LIMIT_PREFIX =
  "Cannot register a new installation because the InboxID";
const INSTALLATION_LIMIT_SUFFIX = "Please revoke existing installations first";

export function xmtpDatabaseFilename(env: XmtpEnv, inboxId: string): string {
  return `xmtp-${env}-${inboxId}.db3`;
}

export function installationIdBytesFromInboxState(
  state: InboxState | undefined,
): Uint8Array[] {
  if (!state) return [];
  return state.installations.map((installation) => installation.bytes);
}

export function classifyXmtpCreateError(error: unknown): XmtpCreateErrorKind {
  const message =
    error instanceof Error ? error.message : typeof error === "string" ? error : "";
  if (
    message.includes(INSTALLATION_LIMIT_PREFIX) &&
    message.includes(INSTALLATION_LIMIT_SUFFIX)
  ) {
    return "installation_limit";
  }
  return "other";
}

export async function resolveInboxId(
  address: `0x${string}`,
  deps?: ResolveInboxIdDeps,
): Promise<string> {
  const identifier = ethereumIdentifier(address);
  const env = getXmtpEnv();
  const createBackendFn = deps?.createBackend ?? createBackend;
  const getInboxIdFn = deps?.getInboxIdForIdentifier ?? getInboxIdForIdentifier;
  const generateInboxIdFn = deps?.generateInboxId ?? generateInboxId;

  try {
    const backend = await createBackendFn({ env });
    const networkInboxId = await getInboxIdFn(backend, identifier);
    if (networkInboxId) return networkInboxId;
  } catch {
    // Network lookup failed — fall back to local derivation.
  }

  return generateInboxIdFn(identifier);
}

function matchesInboxDatabaseFile(path: string, env: XmtpEnv, inboxId: string): boolean {
  return path === xmtpDatabaseFilename(env, inboxId);
}

export async function resetLocalXmtpDatabase(address: `0x${string}`): Promise<boolean> {
  const env = getXmtpEnv();
  const inboxId = await resolveInboxId(address);

  const opfs = await Opfs.create();
  try {
    const files = await opfs.listFiles();
    for (const path of files) {
      if (matchesInboxDatabaseFile(path, env, inboxId)) {
        await opfs.deleteFile(path);
      }
    }
    return true;
  } finally {
    opfs.close();
  }
}

export async function revokeAllInstallations(
  signer: Signer,
  address: `0x${string}`,
): Promise<number> {
  const env = getXmtpEnv();
  const inboxId = await resolveInboxId(address);
  const states = await Client.fetchInboxStates([inboxId], env);
  const installationIds = installationIdBytesFromInboxState(states[0]);
  if (installationIds.length === 0) {
    return 0;
  }

  await Client.revokeInstallations(signer, inboxId, installationIds, env);
  return installationIds.length;
}

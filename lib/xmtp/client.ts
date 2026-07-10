"use client";

import {
  Client,
  IdentifierKind,
  type ClientOptions,
  type Signer,
  type XmtpEnv,
} from "@xmtp/client";
import type { WalletClient } from "viem";
import { getAddress, hexToBytes } from "viem";

import { isOpfsLockError } from "@/lib/xmtp/opfs-lock-error";
import type { XmtpClient } from "@/lib/xmtp/helpers";

export function getXmtpEnv(): XmtpEnv {
  const raw = process.env.NEXT_PUBLIC_XMTP_ENV?.trim();
  if (
    raw === "local" ||
    raw === "dev" ||
    raw === "production" ||
    raw === "testnet-staging" ||
    raw === "testnet-dev" ||
    raw === "testnet" ||
    raw === "mainnet"
  ) {
    return raw;
  }
  return "production";
}

export function ethereumIdentifier(address: `0x${string}`) {
  const addr = getAddress(address);
  return {
    identifier: addr.toLowerCase(),
    identifierKind: IdentifierKind.Ethereum,
  };
}

function buildEoaSigner(walletClient: WalletClient, address: `0x${string}`): Signer {
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

/**
 * XMTP Browser SDK v7 expects a {@link Signer}, not a raw viem wallet client.
 */
export async function createXmtpClient(
  walletClient: WalletClient,
  address: `0x${string}`,
): Promise<XmtpClient> {
  const signer = buildEoaSigner(walletClient, address);
  const options = { env: getXmtpEnv() } as ClientOptions;
  return Client.create(signer, options);
}

/**
 * Restore an existing local XMTP installation without a signer (no wallet signature).
 */
export async function buildXmtpClient(address: `0x${string}`): Promise<XmtpClient | null> {
  try {
    const options = { env: getXmtpEnv() } as ClientOptions;
    const client = await Client.build(ethereumIdentifier(address), options);
    const registered = await client.isRegistered();
    if (!registered) {
      client.close();
      return null;
    }
    return client;
  } catch (error) {
    if (isOpfsLockError(error)) throw error;
    return null;
  }
}

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
  return "dev";
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
): Promise<Awaited<ReturnType<typeof Client.create>>> {
  const signer = buildEoaSigner(walletClient, address);
  const options = { env: getXmtpEnv() } as ClientOptions;
  const client = await Client.create(signer, options);
  await client.conversations.sync();
  return client;
}

"use client";

import { createSiweMessage } from "viem/siwe";

/** Sign SIWE and establish an httpOnly session cookie via `/api/auth/siwe/verify`. */
export async function ensureSiweSession(params: {
  address: `0x${string}`;
  chainId: number;
  signMessageAsync: (args: { message: string }) => Promise<`0x${string}`>;
}): Promise<void> {
  const message = createSiweMessage({
    address: params.address,
    chainId: params.chainId,
    domain: window.location.host,
    uri: window.location.origin,
    version: "1",
    statement: "Sign in to Kargain to upload files.",
    nonce: crypto.randomUUID(),
  });

  const signature = await params.signMessageAsync({ message });
  const res = await fetch("/api/auth/siwe/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, signature }),
    credentials: "include",
  });

  if (!res.ok) {
    throw new Error("siwe_session_failed");
  }
}

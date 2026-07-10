import type { WalletClient } from "viem";

const WALLET_CLIENT_WAIT_MS = 3000;
const WALLET_CLIENT_POLL_MS = 100;

/** Resolve a wagmi wallet client, polling briefly when the hook value is not ready yet. */
export async function waitForWalletClient(
  getCurrent: () => WalletClient | undefined,
): Promise<WalletClient | null> {
  const deadline = Date.now() + WALLET_CLIENT_WAIT_MS;
  while (Date.now() < deadline) {
    const client = getCurrent();
    if (client) return client;
    await new Promise((resolve) => setTimeout(resolve, WALLET_CLIENT_POLL_MS));
  }
  return null;
}

import type { Connector } from "wagmi";
import type { WalletClient } from "viem";

const WALLET_CLIENT_WAIT_MS = 3000;
const WALLET_CLIENT_POLL_MS = 100;

type ConnectorWithWalletClient = Connector & {
  getWalletClient?: (parameters: { chainId: number }) => Promise<WalletClient>;
};

/** Resolve a wagmi wallet client, polling briefly when the hook value is not ready yet. */
export async function waitForWalletClient(
  connector: Connector | undefined,
  chainId: number,
  current: WalletClient | undefined,
): Promise<WalletClient | null> {
  if (current) return current;

  const getWalletClient = (connector as ConnectorWithWalletClient | undefined)?.getWalletClient;
  if (typeof getWalletClient !== "function") return null;

  const deadline = Date.now() + WALLET_CLIENT_WAIT_MS;
  while (Date.now() < deadline) {
    try {
      const client = await getWalletClient({ chainId });
      if (client) return client;
    } catch {
      /* wallet extension may not be ready yet */
    }
    await new Promise((resolve) => setTimeout(resolve, WALLET_CLIENT_POLL_MS));
  }

  return null;
}

import { clearSiweSession } from "@/lib/auth/clear-siwe-session";

/** End server SIWE session and disconnect the wagmi wallet. */
export async function endWalletSession(disconnect: () => void): Promise<void> {
  await clearSiweSession();
  disconnect();
}

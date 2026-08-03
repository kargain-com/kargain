import type { Address, WalletClient } from "viem";

import {
  supportsPersonalSignIdentity,
  readAccountKind,
  readAccountKindOnCommercialChains,
  type WalletAccountKind,
} from "@/lib/web3/wallet-account";
import type { Clock, MessagingWalletKind, WalletPort } from "../ports";

/**
 * How long waitUntilReady polls for a connected wallet client before failing.
 * Smaller: brief wallet connect races throw “not ready” during enable.
 * Larger: a disconnected wallet holds create/enable reconciling longer.
 */
export const WALLET_CLIENT_WAIT_MS = 3_000;

/**
 * Poll interval while waiting for the wallet client inside WALLET_CLIENT_WAIT_MS.
 * Smaller: hotter CPU/wakeups with little UX gain. Larger: readiness detected
 * later within the same overall wait budget.
 */
export const WALLET_CLIENT_POLL_MS = 100;

function mapWalletKind(kind: WalletAccountKind): MessagingWalletKind {
  return kind;
}

export type CreateWalletAdapterInput = {
  getAddress: () => Address | null;
  getWalletClient: () => WalletClient | undefined;
  /** Wallet commercial chain when known; otherwise commercial-union probe. */
  getChainId?: () => number | null | undefined;
  clock: Clock;
};

export function createWalletAdapter(input: CreateWalletAdapterInput): WalletPort {
  let cachedKind: MessagingWalletKind | null = null;
  let kindAddress: string | null = null;
  let kindProbed = false;
  let kindProbePromise: Promise<void> | null = null;

  async function refreshKind(address: Address): Promise<MessagingWalletKind> {
    const key = address.toLowerCase();
    if (kindAddress === key && cachedKind) return cachedKind;
    const chainId = input.getChainId?.() ?? null;
    const kind = mapWalletKind(
      chainId != null
        ? await readAccountKind(chainId, address)
        : await readAccountKindOnCommercialChains(address),
    );
    kindAddress = key;
    cachedKind = kind;
    kindProbed = true;
    return kind;
  }

  async function ensureAccountKindProbed(): Promise<void> {
    const address = input.getAddress();
    if (!address) {
      kindProbed = true;
      return;
    }
    if (kindProbed && kindAddress === address.toLowerCase() && cachedKind) return;
    if (kindProbePromise) {
      await kindProbePromise;
      return;
    }
    kindProbePromise = refreshKind(address).then(() => undefined);
    try {
      await kindProbePromise;
    } finally {
      kindProbePromise = null;
    }
  }

  return {
    getAddress() {
      return input.getAddress();
    },

    getAccountKind() {
      const address = input.getAddress();
      if (!address) return null;
      if (kindAddress === address.toLowerCase() && cachedKind) return cachedKind;
      return null;
    },

    ensureAccountKindProbed,

    async waitUntilReady(signal) {
      const deadline = input.clock.nowMs() + WALLET_CLIENT_WAIT_MS;
      while (input.clock.nowMs() < deadline) {
        if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
        const client = input.getWalletClient();
        const address = input.getAddress();
        if (client && address) {
          const kind = await refreshKind(address);
          if (!supportsPersonalSignIdentity(kind)) {
            throw new Error("Contract wallet cannot initialize messaging");
          }
          return;
        }
        await input.clock.sleep(WALLET_CLIENT_POLL_MS, signal);
      }
      throw new Error("Wallet client not ready");
    },
  };
}

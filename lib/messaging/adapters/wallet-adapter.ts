import type { Address, WalletClient } from "viem";

import {
  canInitializeMessaging,
  readAccountKind,
  type WalletAccountKind,
} from "@/lib/web3/wallet-account";
import { DEFAULT_CHAIN_ID } from "@/lib/web3/supported-chains";
import type { Clock, MessagingWalletKind, WalletPort } from "../ports";

const WALLET_CLIENT_WAIT_MS = 3_000;
const WALLET_CLIENT_POLL_MS = 100;

function mapWalletKind(kind: WalletAccountKind): MessagingWalletKind {
  return kind;
}

export type CreateWalletAdapterInput = {
  getAddress: () => Address | null;
  getWalletClient: () => WalletClient | undefined;
  chainId?: number;
  clock: Clock;
};

export function createWalletAdapter(input: CreateWalletAdapterInput): WalletPort {
  const chainId = input.chainId ?? DEFAULT_CHAIN_ID;
  let cachedKind: MessagingWalletKind | null = null;
  let kindAddress: string | null = null;

  async function refreshKind(address: Address): Promise<MessagingWalletKind> {
    const key = address.toLowerCase();
    if (kindAddress === key && cachedKind) return cachedKind;
    const kind = mapWalletKind(await readAccountKind(chainId, address));
    kindAddress = key;
    cachedKind = kind;
    return kind;
  }

  return {
    getAddress() {
      return input.getAddress();
    },

    getAccountKind() {
      const address = input.getAddress();
      if (!address) return null;
      if (kindAddress === address.toLowerCase() && cachedKind) return cachedKind;
      return "eoa";
    },

    async waitUntilReady(signal) {
      const deadline = input.clock.nowMs() + WALLET_CLIENT_WAIT_MS;
      while (input.clock.nowMs() < deadline) {
        if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
        const client = input.getWalletClient();
        const address = input.getAddress();
        if (client && address) {
          const kind = await refreshKind(address);
          if (!canInitializeMessaging(kind)) {
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

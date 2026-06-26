import { getAddress } from "viem";

import {
  chainlinkEurUsdFeed,
  chainlinkNativeUsdFeed,
  karPassportAddress,
  karProPassAddress,
  karProStakingAddress,
  marketplaceAddress,
  usdcAddress,
} from "@/lib/web3/deployment-addresses";
import { getPublicClient } from "@/lib/web3/public-client";
import { DEFAULT_CHAIN_ID, getViemChain } from "@/lib/web3/supported-chains";

export type WalletAccountKind = "eoa" | "eip7702" | "contract";

type Eip1193Provider = {
  request: (args: { method: string; params?: readonly unknown[] }) => Promise<unknown>;
};

export function classifyBytecode(code: string | undefined | null): WalletAccountKind {
  if (!code || code === "0x" || code === "0x0") {
    return "eoa";
  }
  if (code.startsWith("0xef0100")) {
    return "eip7702";
  }
  return "contract";
}

function normalizeAddress(address: string): `0x${string}` | null {
  try {
    return getAddress(address);
  } catch {
    return null;
  }
}

/** On-chain protocol contracts — not timelock (may share a deployer EOA in test configs). */
export function allProtocolAddresses(chainId?: number): `0x${string}`[] {
  const cid = chainId ?? DEFAULT_CHAIN_ID;
  const candidates = [
    karPassportAddress(cid),
    marketplaceAddress(cid),
    karProPassAddress(cid),
    karProStakingAddress(cid),
    usdcAddress(cid),
    chainlinkNativeUsdFeed(cid),
    chainlinkEurUsdFeed(cid),
  ];
  return candidates.filter((addr): addr is `0x${string}` => Boolean(addr));
}

export function isProtocolAddress(address: string, chainId?: number): boolean {
  const normalized = normalizeAddress(address);
  if (!normalized) return false;
  const lower = normalized.toLowerCase();
  return allProtocolAddresses(chainId).some((addr) => addr.toLowerCase() === lower);
}

export function isMessageablePeer(address: string, chainId?: number): boolean {
  return !isProtocolAddress(address, chainId);
}

export async function readAccountKind(
  chainId: number,
  address: `0x${string}`,
): Promise<WalletAccountKind> {
  try {
    const bytecode = await getPublicClient(chainId).getBytecode({ address });
    return classifyBytecode(bytecode);
  } catch {
    return "eoa";
  }
}

export async function readAccountKindFromProvider(
  provider: unknown,
  address: string,
): Promise<WalletAccountKind> {
  if (!provider || typeof provider !== "object" || !("request" in provider)) {
    return "eoa";
  }
  try {
    const eip1193 = provider as Eip1193Provider;
    const code = (await eip1193.request({
      method: "eth_getCode",
      params: [address, "latest"],
    })) as string;
    return classifyBytecode(code);
  } catch {
    return "eoa";
  }
}

export function explorerAddressUrl(chainId: number, address: string): string {
  const normalized = normalizeAddress(address) ?? address;
  const explorer =
    getViemChain(chainId)?.blockExplorers?.default?.url ?? "https://sepolia.basescan.org";
  return `${explorer}/address/${normalized}`;
}

export function messagingWalletError(kind: WalletAccountKind): string | null {
  if (kind === "contract") {
    return "This address cannot receive messages.";
  }
  return null;
}

/** Whether the connected wallet may attempt XMTP registration. */
export function canInitializeMessaging(kind: WalletAccountKind): boolean {
  return kind !== "contract";
}

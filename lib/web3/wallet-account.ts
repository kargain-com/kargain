import { getAddress } from "viem";

import {
  auctionEscrowAddress,
  chainlinkEurUsdFeed,
  chainlinkNativeUsdFeed,
  karPassportAddress,
  karProPassAddress,
  karProStakingAddress,
  kargainContractDenylist,
  marketplaceAddress,
  bridgeGatewayAddress,
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

/** On-chain protocol contracts — not timelock (env-only when TimelockController exists). */
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
    bridgeGatewayAddress(cid),
    auctionEscrowAddress(cid),
  ];

  candidates.push(...kargainContractDenylist(cid));


  const seen = new Set<string>();
  const out: `0x${string}`[] = [];
  for (const addr of candidates) {
    if (!addr) continue;
    const key = addr.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(addr);
  }
  return out;
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

const SMART_WALLET_PHOTO_COUNT_THRESHOLD = 1;
const SMART_WALLET_UPLOAD_BYTES_THRESHOLD = 1_500_000;
const LARGE_UPLOAD_BYTES_THRESHOLD = 5_000_000;

export function passportStorageUploadHint(input: {
  kind: WalletAccountKind;
  photoCount: number;
  totalBytes: number;
}): string | null {
  const { kind, photoCount, totalBytes } = input;

  if (
    kind === "contract" &&
    (photoCount > SMART_WALLET_PHOTO_COUNT_THRESHOLD ||
      totalBytes > SMART_WALLET_UPLOAD_BYTES_THRESHOLD)
  ) {
    return (
      "Smart contract wallets may fail the separate Irys storage deposit needed for multiple photos. " +
      "Photos are optimized to about 100 KB each before upload. Try a standard MetaMask account for upload, " +
      "use fewer photos, or keep one photo. Minting the passport still works with any wallet."
    );
  }

  if (
    (kind === "eoa" || kind === "eip7702") &&
    totalBytes > LARGE_UPLOAD_BYTES_THRESHOLD
  ) {
    return (
      "This upload is large. Your wallet may ask for a separate Base Sepolia ETH deposit to Irys " +
      "before photos upload. That is storage cost, not mint gas."
    );
  }

  return null;
}

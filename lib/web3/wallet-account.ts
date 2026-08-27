import { commercialEip155Ids } from "@/lib/web3/commercial-active";
import {
  chainlinkEurUsdFeed,
  chainlinkNativeUsdFeed,
  karPassportAddress,
  karProPassAddress,
  karProStakingAddress,
  kargainContractDenylist,
  bridgeGatewayAddress,
  usdcAddress,
} from "@/lib/web3/deployment-addresses";
import {
  normalizeProtocolAddress,
  protocolAddressDedupKey,
  protocolAddressesEqual,
} from "@/lib/web3/protocol-address";
import { getPublicClient } from "@/lib/web3/public-client";
import { getViemChain } from "@/lib/web3/supported-chains";

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

/** On-chain protocol contracts — not timelock (env-only when TimelockController exists). */
export function allProtocolAddresses(chainId: number): `0x${string}`[] {
  const candidates = [
    karPassportAddress(chainId),
    karProPassAddress(chainId),
    karProStakingAddress(chainId),
    usdcAddress(chainId),
    chainlinkNativeUsdFeed(chainId),
    chainlinkEurUsdFeed(chainId),
    bridgeGatewayAddress(chainId),
  ];

  candidates.push(...kargainContractDenylist(chainId));

  const seen = new Set<string>();
  const out: `0x${string}`[] = [];
  for (const addr of candidates) {
    if (!addr) continue;
    const key = protocolAddressDedupKey(chainId, addr);
    if (key == null || seen.has(key)) continue;
    seen.add(key);
    const normalized = normalizeProtocolAddress(chainId, addr);
    if (normalized == null) continue;
    out.push(normalized as `0x${string}`);
  }
  return out;
}

export function isProtocolAddress(address: string, chainId: number): boolean {
  const normalized = normalizeProtocolAddress(chainId, address);
  if (!normalized) return false;
  return allProtocolAddresses(chainId).some((addr) =>
    protocolAddressesEqual(chainId, addr, normalized),
  );
}

/**
 * True if `address` is a protocol/denylist contract on any commercial chain.
 * Membership remains per-chainId (SPEC §I.12.12) — no flat address-only set.
 */
export function isProtocolAddressOnCommercialChains(address: string): boolean {
  return commercialEip155Ids().some((id) => isProtocolAddress(address, id));
}

export function isMessageablePeer(address: string, chainId: number): boolean {
  return !isProtocolAddress(address, chainId);
}

/** Messageable across the commercial write-union (not a protocol address on any commercial chain). */
export function isMessageablePeerOnCommercialChains(address: string): boolean {
  return !isProtocolAddressOnCommercialChains(address);
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

/**
 * Account kind across commercial chains — contract if any chain reports contract.
 * Used when no single wallet commercial chain is available (messaging identity).
 */
export async function readAccountKindOnCommercialChains(
  address: `0x${string}`,
): Promise<WalletAccountKind> {
  const chainIds = commercialEip155Ids();
  const kinds = await Promise.all(
    chainIds.map((id) => readAccountKind(id, address)),
  );
  if (kinds.some((k) => k === "contract")) return "contract";
  if (kinds.some((k) => k === "eip7702")) return "eip7702";
  return "eoa";
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
  const normalized = normalizeProtocolAddress(chainId, address) ?? address;
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

/**
 * Whether this account may derive app identity from personal_sign.
 * Contract accounts are refused: signatures are not ECDSA-recoverable for
 * attestation and may be non-deterministic. Shared by XMTP messaging and
 * Nostr key derivation — do not fork this predicate.
 */
export function supportsPersonalSignIdentity(kind: WalletAccountKind): boolean {
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
      "This upload is large. Your wallet may ask for a separate testnet ETH deposit to Irys " +
      "before photos upload. That is storage cost, not mint gas."
    );
  }

  return null;
}

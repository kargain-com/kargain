import {
  commercialEip155Ids,
  evmProtocolAddresses,
  requireEvmCommercialActive,
  resolveEvmChain,
  type Eip155ChainId,
} from "@/lib/web3/commercial-active";
import {
  normalizeProtocolAddress,
  protocolAddressesEqual,
} from "@/lib/web3/protocol-address";
import { getPublicClient } from "@/lib/web3/public-client";

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

/**
 * True when `address` is a Kargain protocol contract on `chainId` — membership
 * is the registry's {@link evmProtocolAddresses}. Never the deployer EOA
 * (SPEC II.4.1). Invalid addresses are not protocol addresses.
 */
export function isProtocolAddress(address: string, chainId: Eip155ChainId): boolean {
  const normalized = normalizeProtocolAddress(chainId, address);
  if (!normalized) return false;
  return evmProtocolAddresses(requireEvmCommercialActive(chainId)).some((addr) =>
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

export function isMessageablePeer(address: string, chainId: Eip155ChainId): boolean {
  return !isProtocolAddress(address, chainId);
}

/** Messageable across the commercial write-union (not a protocol address on any commercial chain). */
export function isMessageablePeerOnCommercialChains(address: string): boolean {
  return !isProtocolAddressOnCommercialChains(address);
}

export type ReadAccountKindCause =
  | "not_evm"
  | "unresolved_namespace"
  | "read_failed";

export type ReadAccountKindResult =
  | { ok: true; kind: WalletAccountKind }
  | { ok: false; cause: ReadAccountKindCause };

export async function readAccountKind(
  chainId: number,
  address: `0x${string}`,
): Promise<ReadAccountKindResult> {
  const resolved = resolveEvmChain(chainId);
  if (!resolved.ok) {
    return { ok: false, cause: resolved.cause };
  }
  try {
    const bytecode = await getPublicClient(resolved.chainId).getBytecode({
      address,
    });
    return { ok: true, kind: classifyBytecode(bytecode) };
  } catch {
    return { ok: false, cause: "read_failed" };
  }
}

/**
 * Account kind across commercial chains — contract if any chain reports contract.
 * `eoa` only when every chain answered ok+eoa (never invent on unread/refusal).
 */
export async function readAccountKindOnCommercialChains(
  address: `0x${string}`,
): Promise<ReadAccountKindResult> {
  const chainIds = commercialEip155Ids();
  if (chainIds.length === 0) {
    return { ok: false, cause: "unresolved_namespace" };
  }
  const kinds = await Promise.all(
    chainIds.map((id) => readAccountKind(id, address)),
  );
  if (kinds.some((k) => k.ok && k.kind === "contract")) {
    return { ok: true, kind: "contract" };
  }
  if (kinds.some((k) => k.ok && k.kind === "eip7702")) {
    return { ok: true, kind: "eip7702" };
  }
  if (kinds.every((k) => k.ok && k.kind === "eoa")) {
    return { ok: true, kind: "eoa" };
  }
  const firstRefuse = kinds.find((k) => !k.ok);
  return firstRefuse && !firstRefuse.ok
    ? firstRefuse
    : { ok: false, cause: "read_failed" };
}

export async function readAccountKindFromProvider(
  provider: unknown,
  address: string,
): Promise<ReadAccountKindResult> {
  if (!provider || typeof provider !== "object" || !("request" in provider)) {
    return { ok: false, cause: "read_failed" };
  }
  try {
    const eip1193 = provider as Eip1193Provider;
    const code = (await eip1193.request({
      method: "eth_getCode",
      params: [address, "latest"],
    })) as string;
    return { ok: true, kind: classifyBytecode(code) };
  } catch {
    return { ok: false, cause: "read_failed" };
  }
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

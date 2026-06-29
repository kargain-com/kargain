import { shortChainName } from "@/lib/web3/supported-chains";

const LOCAL_ID_MASK = (1n << 128n) - 1n;

export type ParsedPassportTokenId = {
  full: string;
  chainId: number;
  localId: bigint;
  isV2Prefixed: boolean;
};

function toBigInt(tokenId: string | bigint): bigint {
  if (typeof tokenId === "bigint") return tokenId;
  const trimmed = tokenId.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new Error(`Invalid passport tokenId: ${tokenId}`);
  }
  return BigInt(trimmed);
}

export function parsePassportTokenId(tokenId: string | bigint): ParsedPassportTokenId {
  const full = toBigInt(tokenId);
  const chainId = Number(full >> 128n);
  const localId = full & LOCAL_ID_MASK;
  return {
    full: full.toString(),
    chainId,
    localId,
    isV2Prefixed: chainId > 0,
  };
}

function resolveChainDisplayName(chainId: number): string {
  const name = shortChainName(chainId);
  if (name === "Unknown network") return `Chain ${chainId}`;
  return name;
}

function formatLocalNumber(tokenId: string | bigint, contextChainId?: number): string {
  const parsed = parsePassportTokenId(tokenId);
  if (parsed.isV2Prefixed) {
    return parsed.localId.toString();
  }
  return parsed.full;
}

function formatChainSuffix(tokenId: string | bigint, contextChainId?: number): string | null {
  const parsed = parsePassportTokenId(tokenId);
  if (parsed.isV2Prefixed) {
    return resolveChainDisplayName(parsed.chainId);
  }
  if (contextChainId != null && contextChainId > 0) {
    return resolveChainDisplayName(contextChainId);
  }
  return null;
}

export function truncatePassportTokenId(full: string, head = 8, tail = 8): string {
  if (full.length <= head + tail + 1) return full;
  return `${full.slice(0, head)}…${full.slice(-tail)}`;
}

/** `#0 · Base Sepolia` or legacy `#5` */
export function formatPassportShortLabel(tokenId: string, contextChainId?: number): string {
  const local = formatLocalNumber(tokenId, contextChainId);
  const chain = formatChainSuffix(tokenId, contextChainId);
  if (chain) return `#${local} · ${chain}`;
  return `#${local}`;
}

/** `Passport #0 · Base Sepolia` */
export function formatPassportTitle(tokenId: string, contextChainId?: number): string {
  const short = formatPassportShortLabel(tokenId, contextChainId);
  if (short.startsWith("#")) return `Passport ${short}`;
  return `Passport ${short}`;
}

/** `KarPassport #0 · Base Sepolia` */
export function formatKarPassportTitle(tokenId: string, contextChainId?: number): string {
  const short = formatPassportShortLabel(tokenId, contextChainId);
  if (short.startsWith("#")) return `KarPassport ${short}`;
  return `KarPassport ${short}`;
}

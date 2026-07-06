import { getAddress } from "viem";

import { shortAddress } from "@/lib/web3/wallet-display";
import { shortChainName } from "@/lib/web3/supported-chains";

export type ParsedProPassTokenId = {
  full: string;
  holderAddress: `0x${string}`;
};

export type FormatProPassShortLabelOptions = {
  showChain?: boolean;
};

function toBigInt(tokenId: string | bigint): bigint {
  if (typeof tokenId === "bigint") return tokenId;
  const trimmed = tokenId.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new Error(`Invalid pro pass tokenId: ${tokenId}`);
  }
  return BigInt(trimmed);
}

/** On-chain KarProPass tokenId = uint256(uint160(holderAddress)). */
export function proPassTokenIdFromAddress(address: string): bigint {
  return BigInt(getAddress(address as `0x${string}`));
}

export function parseProPassTokenId(tokenId: string | bigint): ParsedProPassTokenId {
  const full = toBigInt(tokenId);
  const hex = full.toString(16).padStart(40, "0");
  const holderAddress = getAddress(`0x${hex}` as `0x${string}`);
  return {
    full: full.toString(),
    holderAddress,
  };
}

function resolveChainDisplayName(chainId: number): string {
  const name = shortChainName(chainId);
  if (name === "Unknown network") return `Chain ${chainId}`;
  return name;
}

export function truncateProPassTokenId(full: string, head = 8, tail = 8): string {
  if (full.length <= head + tail + 1) return full;
  return `${full.slice(0, head)}…${full.slice(-tail)}`;
}

/** `#0x742d·6634 · Base Sepolia` or `#0x742d·6634` when showChain is false. */
export function formatProPassShortLabel(
  tokenId: string | bigint,
  contextChainId?: number,
  options: FormatProPassShortLabelOptions = {},
): string {
  const { showChain = true } = options;
  const parsed = parseProPassTokenId(tokenId);
  const serial = shortAddress(parsed.holderAddress);
  if (showChain && contextChainId != null && contextChainId > 0) {
    return `#${serial} · ${resolveChainDisplayName(contextChainId)}`;
  }
  return `#${serial}`;
}

/** `Pass #0x742d·6634 · Base Sepolia` */
export function formatProPassTitle(
  tokenId: string | bigint,
  contextChainId?: number,
  options: FormatProPassShortLabelOptions = {},
): string {
  const short = formatProPassShortLabel(tokenId, contextChainId, options);
  return `Pass ${short}`;
}

/** `KarProPass #0x742d·6634 · Base Sepolia` */
export function formatKarProPassTitle(
  tokenId: string | bigint,
  contextChainId?: number,
  options: FormatProPassShortLabelOptions = {},
): string {
  const short = formatProPassShortLabel(tokenId, contextChainId, options);
  return `KarProPass ${short}`;
}

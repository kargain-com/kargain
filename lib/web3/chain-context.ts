import { COMMERCIAL_ACTIVE, isCommercialChainId } from "@/lib/web3/commercial-active";
import { isKargainWriteChain } from "@/lib/web3/chain-selector-state";

/**
 * Explicit chain-role resolvers for multichain UI/commerce.
 * Missing or non-commercial → null — never invent a hub default.
 */

/** Sorted commercial chain ids from COMMERCIAL_ACTIVE (UI lists, OR loops). */
export function commercialChainIds(): readonly number[] {
  return Object.keys(COMMERCIAL_ACTIVE)
    .map(Number)
    .sort((a, b) => a - b);
}

/**
 * Wallet write target for commerce / KarPro / mint / fee.
 * Commercial wallet only; missing / NaN / non-commercial → null.
 */
export function resolveWalletCommercialChainId(
  walletChainId: number | undefined,
): number | null {
  if (walletChainId == null || !Number.isFinite(walletChainId)) return null;
  if (!isCommercialChainId(walletChainId)) return null;
  return walletChainId;
}

/** Parse URL/query raw → positive int or null (no hub fallback). */
export function parseOptionalChainParam(
  raw: string | string[] | undefined | null,
): number | null {
  const s = Array.isArray(raw) ? raw[0] : raw;
  if (!s) return null;
  const n = Number.parseInt(s, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** URL expected for wrong-network: only when present + write-union; else null. */
export function resolveUrlExpectedChainId(
  raw: string | string[] | undefined | null,
): number | null {
  const parsed = parseOptionalChainParam(raw);
  if (parsed == null) return null;
  return isKargainWriteChain(parsed) ? parsed : null;
}

/** Commerce page chain: custody only; non-commercial / missing → null. */
export function resolveCustodyCommerceChainId(
  custodyChain: number | null | undefined,
): number | null {
  if (custodyChain == null || !Number.isFinite(custodyChain)) return null;
  if (!isCommercialChainId(custodyChain)) return null;
  return custodyChain;
}

/** Origin for titles/labels; optional, never invent hub. */
export function resolveOriginChainId(
  originChain: number | null | undefined,
): number | null {
  if (originChain == null || !Number.isFinite(originChain)) return null;
  if (!isCommercialChainId(originChain)) return null;
  return originChain;
}

/**
 * Nav Auctions chain without hub invent:
 * - connected + wallet commercial with the ascending mode → that chain
 * - connected + non-commercial (or commercial without the mode) → null (hide)
 * - guest → first commercial (sorted) that has the ascending mode deployed
 */
export function resolveAuctionsNavChainId(input: {
  walletChainId: number | undefined;
  isConnected: boolean;
  hasAscendingMode: (chainId: number) => boolean;
}): number | null {
  const { walletChainId, isConnected, hasAscendingMode } = input;
  if (isConnected) {
    const commercial = resolveWalletCommercialChainId(walletChainId);
    if (commercial == null) return null;
    return hasAscendingMode(commercial) ? commercial : null;
  }
  for (const id of commercialChainIds()) {
    if (hasAscendingMode(id)) return id;
  }
  return null;
}

/** Explicit FX pin — Chainlink display feeds (not commerce default). */
export const FX_RATE_CHAIN_ID = 84532;

export function fxRateChainId(): number {
  return FX_RATE_CHAIN_ID;
}

/**
 * Explicit Irys/gateway env class pin (testnet class until mainnet).
 * Not a commerce-chain default.
 */
export const STORAGE_ENV_CHAIN_ID = 84532;

export function storageEnvChainId(): number {
  return STORAGE_ENV_CHAIN_ID;
}

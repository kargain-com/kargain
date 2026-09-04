/**
 * Explicit chain-role resolvers for multichain UI/commerce.
 * Missing or non-commercial → null — never invent a hub default.
 *
 * Role map when an SVM commercial row eventually exists (`vm: "svm"`):
 * - **commercial union / wallet commercial / custody commerce** — keyed by
 *   namespace (`2_000_040_168`), not EIP-155; `commercialChainIds()` stays
 *   EVM-only (`commercialEip155Ids`) until a dedicated SVM list exists.
 * - **storage / FX env pins** — remain EVM env-class (`STORAGE_ENV_CHAIN_ID` /
 *   `FX_RATE_CHAIN_ID`); Solana does not inherit those pins by namespace.
 * - Until then, reserved-band namespaces without a registry row fail closed
 *   via `requireCommercialActive` (not selectable).
 */

import {
  commercialEip155Ids,
  isCommercialEip155Id,
  isCommercialNamespace,
  requireCommercialActive,
  type CommercialActiveStack,
} from "@/lib/web3/commercial-active";
import { isKargainWriteChain } from "@/lib/web3/chain-selector-state";

/** Sorted commercial EIP-155 ids from COMMERCIAL_ACTIVE (UI lists, OR loops). */
export function commercialChainIds(): readonly number[] {
  return commercialEip155Ids();
}

/**
 * Wallet write target for commerce / KarPro / mint / fee.
 * Commercial **EVM** wallet only; missing / NaN / non-EVM-commercial → null.
 */
export function resolveWalletCommercialChainId(
  walletChainId: number | undefined,
): number | null {
  if (walletChainId == null || !Number.isFinite(walletChainId)) return null;
  if (!isCommercialEip155Id(walletChainId)) return null;
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

/**
 * Commerce page chain: custody namespace (EVM EIP-155 or SVM reserved-band).
 * Non-commercial / missing → null.
 */
export function resolveCustodyCommerceChainId(
  custodyChain: number | null | undefined,
): number | null {
  if (custodyChain == null || !Number.isFinite(custodyChain)) return null;
  if (!isCommercialNamespace(custodyChain)) return null;
  return custodyChain;
}

/** Origin for titles/labels; any commercial namespace; never invent hub. */
export function resolveOriginChainId(
  originChain: number | null | undefined,
): number | null {
  if (originChain == null || !Number.isFinite(originChain)) return null;
  if (!isCommercialNamespace(originChain)) return null;
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

/**
 * Explicit FX pin — Chainlink display feeds (not commerce default).
 * Env pin (not registry-derived); leave as literal until multi-hub FX (S4+).
 */
export const FX_RATE_CHAIN_ID = 84532;

/**
 * FX env pin for a commercial stack. EVM → hub pin; non-EVM refuses by name
 * (SVM has no Chainlink env class).
 */
export function fxRateChainIdFor(stack: CommercialActiveStack): number {
  if (stack.vm !== "evm") {
    throw new Error(
      `fxRateChainIdFor: namespace ${stack.namespace} has no FX env pin (vm=${stack.vm})`,
    );
  }
  return FX_RATE_CHAIN_ID;
}

/**
 * FX pin for the hub env-class commercial stack (display rates).
 * Sole composition used by Chainlink rate reads.
 */
export function hubFxRateChainId(): number {
  return fxRateChainIdFor(requireCommercialActive(FX_RATE_CHAIN_ID));
}

/** @deprecated Prefer {@link fxRateChainIdFor} with an EVM commercial stack. */
export function fxRateChainId(): number {
  return FX_RATE_CHAIN_ID;
}

/**
 * Explicit Irys/gateway env class pin (testnet class until mainnet).
 * Not a commerce-chain default. Env pin — not registry-derived.
 */
export const STORAGE_ENV_CHAIN_ID = 84532;

/**
 * Storage env pin for a commercial stack. EVM → testnet class pin; non-EVM
 * refuses by name (SVM does not inherit Irys/gateway env by namespace).
 */
export function storageEnvChainIdFor(stack: CommercialActiveStack): number {
  if (stack.vm !== "evm") {
    throw new Error(
      `storageEnvChainIdFor: namespace ${stack.namespace} has no storage env pin (vm=${stack.vm})`,
    );
  }
  return STORAGE_ENV_CHAIN_ID;
}

/** @deprecated Prefer {@link storageEnvChainIdFor} with an EVM commercial stack. */
export function storageEnvChainId(): number {
  return STORAGE_ENV_CHAIN_ID;
}

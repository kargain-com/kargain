/**
 * Sole derivation of fixed-price Asking price display — Asset token units or
 * Fiat 1e8. Matches settlement (`quoteBuy` returns price as-is under Asset).
 */

import { formatUnits } from "viem";

import {
  DENOMINATION_KIND,
  decodeCurrencyCode,
  type DenominationKind,
} from "@/lib/commerce/denomination";
import { resolveSettlementAssetMeta } from "@/lib/commerce/settlement-asset-meta";

export type ListingAskingPrice =
  | {
      status: "fiat";
      amount1e8: bigint;
      currencyCode: string;
    }
  | {
      status: "asset";
      amount: bigint;
      decimals: number;
      unitLabel: string;
    }
  | { status: "unresolved" };

function toBigInt(price: string | bigint | number | null | undefined): bigint | null {
  if (price == null) return null;
  try {
    if (typeof price === "bigint") return price;
    if (typeof price === "number") {
      if (!Number.isFinite(price)) return null;
      return BigInt(Math.trunc(price));
    }
    const t = String(price).trim();
    if (!t) return null;
    return BigInt(t);
  } catch {
    return null;
  }
}

function fiatCurrencyLabel(currencyCode: string | null | undefined): string {
  if (currencyCode == null) return "USD";
  const raw = currencyCode.trim();
  if (!raw) return "USD";
  if (raw.startsWith("0x")) {
    return decodeCurrencyCode(raw) || "USD";
  }
  return raw.toUpperCase();
}

/**
 * Derive Asking price facts for browse/detail/edit.
 * Pass `erc20Decimals` when known from chain; otherwise USDC/native resolve
 * from {@link resolveSettlementAssetMeta}.
 */
export function deriveListingAskingPrice(input: {
  denominationKind: DenominationKind | null | undefined;
  price: string | bigint | number | null | undefined;
  currencyCode?: string | null;
  asset?: string | null;
  chainId: number;
  /** Override when a successful ERC-20 decimals read is available. */
  erc20Decimals?: number | null;
}): ListingAskingPrice {
  if (
    input.denominationKind !== DENOMINATION_KIND.Asset &&
    input.denominationKind !== DENOMINATION_KIND.Fiat
  ) {
    return { status: "unresolved" };
  }

  const amount = toBigInt(input.price);
  if (amount == null || amount <= 0n) return { status: "unresolved" };

  if (input.denominationKind === DENOMINATION_KIND.Fiat) {
    return {
      status: "fiat",
      amount1e8: amount,
      currencyCode: fiatCurrencyLabel(input.currencyCode),
    };
  }

  const meta = resolveSettlementAssetMeta({
    chainId: input.chainId,
    asset: input.asset,
  });
  const decimals =
    input.erc20Decimals != null && Number.isFinite(input.erc20Decimals)
      ? Number(input.erc20Decimals)
      : meta.decimals;
  if (decimals == null || !Number.isFinite(decimals)) {
    return { status: "unresolved" };
  }

  return {
    status: "asset",
    amount,
    decimals,
    unitLabel: meta.label,
  };
}

/** Format asset asking amount (no inventing fiat). Trailing zeros trimmed. */
export function formatListingAssetAsking(
  amount: bigint,
  decimals: number,
  unitLabel: string,
): string {
  const raw = formatUnits(amount, decimals);
  // Avoid scientific notation for large whole USDC amounts
  const trimmed = raw.includes(".")
    ? raw.replace(/\.?0+$/, "")
    : raw;
  return `${trimmed} ${unitLabel}`;
}

/** Human unit for the asking-price input (form chrome). */
export function askingPriceInputUnit(input: {
  denominationKind: DenominationKind;
  fiatCurrencyCode?: string;
  settlementAsset: string;
  chainId: number;
}): string {
  if (input.denominationKind === DENOMINATION_KIND.Fiat) {
    return (input.fiatCurrencyCode ?? "USD").trim().toUpperCase() || "USD";
  }
  return resolveSettlementAssetMeta({
    chainId: input.chainId,
    asset: input.settlementAsset,
  }).label;
}

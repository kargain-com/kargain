/**
 * Sole derivation of fixed-price Asking price — on-chain truth (fiat 1e8 /
 * asset units) plus display-only FX source for nav convertPrice.
 *
 * Settlement (`quoteBuy`) always uses asset/fiat on-chain units; display may
 * peg USDC→USD or convert native via injected ETH/USD without inventing feeds.
 */

import { formatUnits } from "viem";

import {
  DENOMINATION_KIND,
  decodeCurrencyCode,
  type DenominationKind,
} from "@/lib/commerce/denomination";
import {
  resolveSettlementAssetMeta,
  type SettlementAssetIdentity,
} from "@/lib/commerce/settlement-asset-meta";
import {
  legacyFiatFromCurrencyCode,
  type LegacyFiatCurrency,
} from "@/lib/marketplace/currency-code";
import { FIAT_SCALE } from "@/lib/marketplace/price-normalize";

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
      identity: SettlementAssetIdentity;
    }
  | { status: "unresolved" };

/** Input for {@link convertPrice} — display FX only, not settlement. */
export type AskingDisplaySource = {
  amount1e8: bigint;
  listingCurrency: LegacyFiatCurrency;
};

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
    identity: meta.identity,
  };
}

/** Sole settlement-form disclosure under Asking. */
export function askingSettlementDisclosure(unitLabel: string): string {
  const label = unitLabel.trim();
  if (!label) return "Checkout settles in the listing settlement asset.";
  return `Checkout settles in ${label}.`;
}

/**
 * Map Asking truth → convertPrice inputs (display FX).
 * USDC pegs 1:1 to USD for display; native needs ethUsd1e8; unknown → null.
 */
export function toAskingDisplaySource(
  asking: ListingAskingPrice,
  opts?: { ethUsd1e8?: bigint | null },
): AskingDisplaySource | null {
  if (asking.status === "unresolved") return null;

  if (asking.status === "fiat") {
    return {
      amount1e8: asking.amount1e8,
      listingCurrency: legacyFiatFromCurrencyCode(asking.currencyCode),
    };
  }

  if (asking.identity === "usdc") {
    const scale = 10n ** BigInt(asking.decimals);
    if (scale <= 0n) return null;
    return {
      amount1e8: (asking.amount * FIAT_SCALE) / scale,
      listingCurrency: 0, // USD
    };
  }

  if (asking.identity === "native") {
    const ethUsd = opts?.ethUsd1e8;
    if (ethUsd == null || ethUsd <= 0n) return null;
    const scale = 10n ** BigInt(asking.decimals);
    if (scale <= 0n) return null;
    return {
      amount1e8: (asking.amount * ethUsd) / scale,
      listingCurrency: 0, // USD
    };
  }

  return null;
}

/** Format asset settlement amount with grouping (no inventing fiat). */
export function formatListingAssetAsking(
  amount: bigint,
  decimals: number,
  unitLabel: string,
): string {
  const raw = formatUnits(amount, decimals);
  const trimmed = raw.includes(".")
    ? raw.replace(/\.?0+$/, "")
    : raw;
  const n = Number.parseFloat(trimmed);
  if (!Number.isFinite(n)) return `${trimmed} ${unitLabel}`;
  const frac = trimmed.includes(".")
    ? (trimmed.split(".")[1]?.length ?? 0)
    : 0;
  const grouped = n.toLocaleString("en-US", {
    maximumFractionDigits: Math.min(frac, 8),
    minimumFractionDigits: 0,
  });
  return `${grouped} ${unitLabel}`;
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

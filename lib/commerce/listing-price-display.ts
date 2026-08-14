/**
 * Sole derivation of fixed-price Asking price — on-chain truth (fiat 1e8 /
 * asset units) plus display-only FX source for nav convertPrice.
 *
 * Settlement (`quoteBuy`) always uses asset/fiat on-chain units; display may
 * peg USDC→USD or convert native via injected ETH/USD without inventing feeds.
 */

import { formatUnits, zeroAddress } from "viem";

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
import { COMMERCIAL_ACTIVE } from "@/lib/web3/commercial-active";

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

/** USDC Asking row — addresses from COMMERCIAL_ACTIVE; decimals from settlement identity. */
export type AskingUsdcFact = {
  chainId: number;
  address: `0x${string}`;
  decimals: number;
};

/** Native (zero) asset — SQL and display treat empty/zero as this identity. */
export const ASKING_NATIVE_ASSET = zeroAddress;

export function askingAssetUsdScale(decimals: number): bigint {
  return 10n ** BigInt(decimals);
}

/**
 * Every commercial USDC admit used for Asking USD 1e8 (cards + browse SQL).
 * Fail-closed if a committed stack's USDC is not a USDC identity.
 */
export function askingUsdcFacts(): AskingUsdcFact[] {
  const facts: AskingUsdcFact[] = [];
  for (const stack of Object.values(COMMERCIAL_ACTIVE)) {
    const meta = resolveSettlementAssetMeta({
      chainId: stack.chainId,
      asset: stack.usdc,
    });
    if (meta.identity !== "usdc" || meta.decimals == null) {
      throw new Error(
        `COMMERCIAL_ACTIVE USDC on chain ${stack.chainId} is not a USDC Asking identity`,
      );
    }
    facts.push({
      chainId: stack.chainId,
      address: stack.usdc,
      decimals: meta.decimals,
    });
  }
  return facts;
}

/** Native Asking decimals — must agree across COMMERCIAL_ACTIVE. */
export function askingNativeDecimals(): number {
  const found = new Set<number>();
  for (const stack of Object.values(COMMERCIAL_ACTIVE)) {
    const meta = resolveSettlementAssetMeta({
      chainId: stack.chainId,
      asset: ASKING_NATIVE_ASSET,
    });
    if (meta.identity !== "native" || meta.decimals == null) {
      throw new Error(
        `native Asking decimals unresolved on chain ${stack.chainId}`,
      );
    }
    found.add(meta.decimals);
  }
  if (found.size !== 1) {
    throw new Error("commercial chains disagree on native Asking decimals");
  }
  return [...found][0]!;
}

/** Asset Asking → USD 1e8. Unknown identity or missing ETH rate → null. */
export function askingAssetAmountToUsd1e8(
  amount: bigint,
  decimals: number,
  identity: SettlementAssetIdentity,
  ethUsd1e8?: bigint | null,
): bigint | null {
  if (decimals < 0 || !Number.isFinite(decimals)) return null;
  const scale = askingAssetUsdScale(decimals);
  if (scale <= 0n) return null;
  if (identity === "usdc") {
    return (amount * FIAT_SCALE) / scale;
  }
  if (identity === "native") {
    if (ethUsd1e8 == null || ethUsd1e8 <= 0n) return null;
    return (amount * ethUsd1e8) / scale;
  }
  return null;
}

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

  const amount1e8 = askingAssetAmountToUsd1e8(
    asking.amount,
    asking.decimals,
    asking.identity,
    opts?.ethUsd1e8,
  );
  if (amount1e8 == null) return null;
  return { amount1e8, listingCurrency: 0 };
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

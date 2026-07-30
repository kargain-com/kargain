"use server";

import { getAddress, zeroAddress } from "viem";

import {
  deriveFixedPriceOpenOptions,
  type FixedPriceOpenOptions,
  type OpenCurrencyFeedInput,
  type OpenPaymentTokenInput,
} from "@/lib/commerce/fixed-price-open-options";
import { commerceModeAddress } from "@/lib/commerce/mode";
import { shortAddress } from "@/lib/web3/wallet-display";
import { ponderBaseUrl, ponderFetch } from "@/lib/web3/ponder-fetch";
import { getViemChain } from "@/lib/web3/supported-chains";

export type FixedPriceOpenOptionsResult = {
  ok: true;
  options: FixedPriceOpenOptions;
  ponderError?: "PONDER_UNAVAILABLE";
};

type PaymentTokensResponse = {
  paymentTokens?: Array<{
    token?: string;
    feed?: string;
    decimals?: number;
    active?: boolean;
    mode?: string;
    modeContract?: string;
  }>;
};

type CurrencyFeedsResponse = {
  currencyFeeds?: Array<{
    currencyCode?: string;
    feed?: string;
    modeContract?: string;
  }>;
};

function nativeLabel(chainId: number): string {
  return getViemChain(chainId)?.nativeCurrency.symbol ?? "ETH";
}

function parsePaymentTokens(
  rows: PaymentTokensResponse["paymentTokens"],
  modeContract: string,
): OpenPaymentTokenInput[] {
  if (!rows) return [];
  const modeLc = modeContract.toLowerCase();
  const out: OpenPaymentTokenInput[] = [];
  for (const row of rows) {
    if (!row?.token) continue;
    if (row.modeContract && row.modeContract.toLowerCase() !== modeLc) continue;
    if (row.mode && row.mode !== "fixedPrice") continue;
    let token: string;
    try {
      token = getAddress(row.token);
    } catch {
      continue;
    }
    if (token.toLowerCase() === zeroAddress) continue;
    out.push({
      token,
      feed: row.feed?.trim() ?? "",
      decimals: Number.isFinite(row.decimals) ? Number(row.decimals) : 18,
      active: row.active !== false,
      label: shortAddress(token),
    });
  }
  return out;
}

function parseCurrencyFeeds(
  rows: CurrencyFeedsResponse["currencyFeeds"],
  modeContract: string,
): OpenCurrencyFeedInput[] {
  if (!rows) return [];
  const modeLc = modeContract.toLowerCase();
  const out: OpenCurrencyFeedInput[] = [];
  for (const row of rows) {
    if (!row?.currencyCode) continue;
    if (row.modeContract && row.modeContract.toLowerCase() !== modeLc) continue;
    out.push({
      currencyCode: row.currencyCode,
      feed: row.feed?.trim() ?? "",
    });
  }
  return out;
}

/**
 * Resolve FixedPrice open pairings for a chain from Ponder commerce projections.
 * Native is always appended by the resolver when the mode is deployed.
 */
export async function getFixedPriceOpenOptions(
  chainId: number,
): Promise<FixedPriceOpenOptionsResult> {
  const mode = commerceModeAddress("fixedPrice", chainId);
  if (!mode) {
    return {
      ok: true,
      options: deriveFixedPriceOpenOptions({
        modeAvailable: false,
        native: { label: nativeLabel(chainId), decimals: 18 },
        paymentTokens: [],
        currencyFeeds: [],
      }),
    };
  }

  const base = ponderBaseUrl();
  const tokensUrl = new URL(`${base}/commerce-payment-tokens`);
  tokensUrl.searchParams.set("chainId", String(chainId));
  tokensUrl.searchParams.set("modeContract", mode);
  tokensUrl.searchParams.set("active", "true");
  tokensUrl.searchParams.set("limit", "100");

  const feedsUrl = new URL(`${base}/commerce-currency-feeds`);
  feedsUrl.searchParams.set("chainId", String(chainId));
  feedsUrl.searchParams.set("modeContract", mode);
  feedsUrl.searchParams.set("limit", "100");

  try {
    const [tokensRes, feedsRes] = await Promise.all([
      ponderFetch(tokensUrl),
      ponderFetch(feedsUrl),
    ]);
    if (!tokensRes.ok || !feedsRes.ok) {
      return {
        ok: true,
        options: deriveFixedPriceOpenOptions({
          modeAvailable: true,
          native: { label: nativeLabel(chainId), decimals: 18 },
          paymentTokens: [],
          currencyFeeds: [],
        }),
        ponderError: "PONDER_UNAVAILABLE",
      };
    }
    const tokensJson = (await tokensRes.json()) as PaymentTokensResponse;
    const feedsJson = (await feedsRes.json()) as CurrencyFeedsResponse;
    return {
      ok: true,
      options: deriveFixedPriceOpenOptions({
        modeAvailable: true,
        native: { label: nativeLabel(chainId), decimals: 18 },
        paymentTokens: parsePaymentTokens(tokensJson.paymentTokens, mode),
        currencyFeeds: parseCurrencyFeeds(feedsJson.currencyFeeds, mode),
      }),
    };
  } catch {
    return {
      ok: true,
      options: deriveFixedPriceOpenOptions({
        modeAvailable: true,
        native: { label: nativeLabel(chainId), decimals: 18 },
        paymentTokens: [],
        currencyFeeds: [],
      }),
      ponderError: "PONDER_UNAVAILABLE",
    };
  }
}

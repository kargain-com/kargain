"use server";

import { getAddress, zeroAddress } from "viem";

import {
  deriveOpenableTerms,
  type OpenCurrencyFeedInput,
  type OpenPaymentTokenInput,
  type OpenableTerms,
} from "@/lib/commerce/openable-terms";
import {
  commerceModeAddress,
  type CommerceMode,
} from "@/lib/commerce/mode";
import { shortAddress } from "@/lib/web3/wallet-display";
import { ponderBaseUrl, ponderFetch } from "@/lib/web3/ponder-fetch";
import { getViemChain } from "@/lib/web3/supported-chains";

export type OpenableTermsResult = {
  ok: true;
  options: OpenableTerms;
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
  mode: CommerceMode,
): OpenPaymentTokenInput[] {
  if (!rows) return [];
  const modeLc = modeContract.toLowerCase();
  const out: OpenPaymentTokenInput[] = [];
  for (const row of rows) {
    if (!row?.token) continue;
    if (row.modeContract && row.modeContract.toLowerCase() !== modeLc) continue;
    if (row.mode && row.mode !== mode) continue;
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

function unresolved(mode: CommerceMode, chainId: number): OpenableTermsResult {
  return {
    ok: true,
    options: deriveOpenableTerms({
      mode,
      modeAvailable: true,
      configResolved: false,
      native: { label: nativeLabel(chainId), decimals: 18 },
      paymentTokens: [],
      currencyFeeds: [],
    }),
    ponderError: "PONDER_UNAVAILABLE",
  };
}

/**
 * Resolve openable / grantable terms for a mode on a chain from Ponder
 * commerce projections. Fail closed when config is unread.
 */
export async function getOpenableTerms(
  chainId: number,
  mode: CommerceMode,
): Promise<OpenableTermsResult> {
  const modeAddress = commerceModeAddress(mode, chainId);
  if (!modeAddress) {
    return {
      ok: true,
      options: deriveOpenableTerms({
        mode,
        modeAvailable: false,
        configResolved: true,
        native: { label: nativeLabel(chainId), decimals: 18 },
        paymentTokens: [],
        currencyFeeds: [],
      }),
    };
  }

  const base = ponderBaseUrl();
  const tokensUrl = new URL(`${base}/commerce-payment-tokens`);
  tokensUrl.searchParams.set("chainId", String(chainId));
  tokensUrl.searchParams.set("modeContract", modeAddress);
  tokensUrl.searchParams.set("active", "true");
  tokensUrl.searchParams.set("limit", "100");

  try {
    if (mode === "ascending") {
      const tokensRes = await ponderFetch(tokensUrl);
      if (!tokensRes.ok) return unresolved(mode, chainId);
      const tokensJson = (await tokensRes.json()) as PaymentTokensResponse;
      return {
        ok: true,
        options: deriveOpenableTerms({
          mode,
          modeAvailable: true,
          configResolved: true,
          native: { label: nativeLabel(chainId), decimals: 18 },
          paymentTokens: parsePaymentTokens(
            tokensJson.paymentTokens,
            modeAddress,
            mode,
          ),
          currencyFeeds: [],
        }),
      };
    }

    const feedsUrl = new URL(`${base}/commerce-currency-feeds`);
    feedsUrl.searchParams.set("chainId", String(chainId));
    feedsUrl.searchParams.set("modeContract", modeAddress);
    feedsUrl.searchParams.set("limit", "100");

    const [tokensRes, feedsRes] = await Promise.all([
      ponderFetch(tokensUrl),
      ponderFetch(feedsUrl),
    ]);
    if (!tokensRes.ok || !feedsRes.ok) return unresolved(mode, chainId);
    const tokensJson = (await tokensRes.json()) as PaymentTokensResponse;
    const feedsJson = (await feedsRes.json()) as CurrencyFeedsResponse;
    return {
      ok: true,
      options: deriveOpenableTerms({
        mode,
        modeAvailable: true,
        configResolved: true,
        native: { label: nativeLabel(chainId), decimals: 18 },
        paymentTokens: parsePaymentTokens(
          tokensJson.paymentTokens,
          modeAddress,
          mode,
        ),
        currencyFeeds: parseCurrencyFeeds(feedsJson.currencyFeeds, modeAddress),
      }),
    };
  } catch {
    return unresolved(mode, chainId);
  }
}

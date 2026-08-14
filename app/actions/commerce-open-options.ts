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
import { resolveSettlementAssetMeta } from "@/lib/commerce/settlement-asset-meta";
import { buildPonderUrl, ponderFetch } from "@/lib/web3/ponder-fetch";
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
  chainId: number,
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
    const meta = resolveSettlementAssetMeta({ chainId, asset: token });
    const ponderDecimals = Number.isFinite(row.decimals)
      ? Number(row.decimals)
      : null;
    const decimals =
      ponderDecimals != null && ponderDecimals > 0
        ? ponderDecimals
        : (meta.decimals ?? 18);
    out.push({
      token,
      feed: row.feed?.trim() ?? "",
      decimals,
      active: row.active !== false,
      label: meta.label,
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

  const tokensUrl = buildPonderUrl(
    "commerce.paymentTokens",
    {},
    {
      chainId,
      modeContract: modeAddress,
      active: true,
      limit: 100,
    },
  );

  try {
    if (mode === "ascending") {
      const tokensRes = await ponderFetch("commerce-payment-tokens", tokensUrl.toString());
      if (!tokensRes.ok) return unresolved(mode, chainId);
      const tokensJson = tokensRes.body as PaymentTokensResponse;
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
            chainId,
          ),
          currencyFeeds: [],
        }),
      };
    }

    const feedsUrl = buildPonderUrl(
      "commerce.currencyFeeds",
      {},
      {
        chainId,
        modeContract: modeAddress,
        limit: 100,
      },
    );

    const [tokensRes, feedsRes] = await Promise.all([
      ponderFetch("commerce-payment-tokens", tokensUrl.toString()),
      ponderFetch("commerce-currency-feeds", feedsUrl.toString()),
    ]);
    if (!tokensRes.ok || !feedsRes.ok) return unresolved(mode, chainId);
    const tokensJson = tokensRes.body as PaymentTokensResponse;
    const feedsJson = feedsRes.body as CurrencyFeedsResponse;
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
          chainId,
        ),
        currencyFeeds: parseCurrencyFeeds(feedsJson.currencyFeeds, modeAddress),
      }),
    };
  } catch {
    return unresolved(mode, chainId);
  }
}

/**
 * Pure FixedPrice open pairings — denomination × settlement asset.
 *
 * Inputs are injected (Ponder payment tokens + currency feeds + native
 * sentinel). Never reads chain ids or token address literals.
 *
 * P4: Fiat + ERC-20 requires a non-zero payment-token feed at open
 * (`PaymentTokenFeedRequired`). Asset denomination is always offered for
 * admitted tokens and native. Non-USD fiat requires a registered currency feed.
 */

const ZERO = "0x0000000000000000000000000000000000000000";

/** Seller-facing copy — mirrors `PaymentTokenFeedRequired` mapper sense. */
export const FIAT_TOKEN_FEED_REQUIRED_REASON =
  "Fiat-priced sales in this token need a payment-token price feed.";

export const FIXED_PRICE_MODE_UNAVAILABLE_REASON =
  "Fixed-price selling is not available on this chain yet.";

export type OpenPaymentTokenInput = {
  /** Checksummed ERC-20 address (never zero — native is separate). */
  token: string;
  /** Empty or zero address → no feed (asset denomination only). */
  feed: string;
  decimals: number;
  active: boolean;
  label: string;
};

export type OpenCurrencyFeedInput = {
  currencyCode: string;
  /** Empty or zero → identity only valid for USD. */
  feed: string;
};

export type FixedPriceOpenOptionsInput = {
  modeAvailable: boolean;
  /** Native settlement — always offered when the mode is available. */
  native: { label: string; decimals: number };
  paymentTokens: readonly OpenPaymentTokenInput[];
  currencyFeeds: readonly OpenCurrencyFeedInput[];
};

export type SettlementAssetOption = {
  /** Zero address for native; otherwise checksummed ERC-20. */
  token: string;
  label: string;
  decimals: number;
  assetDenomination: true;
  fiatDenomination: boolean;
  /** Present when Fiat is withheld for this asset. */
  fiatUnavailableReason?: string;
};

export type FixedPriceOpenOptions = {
  available: boolean;
  unavailableReason?: string;
  assets: SettlementAssetOption[];
  /** Fiat ISO codes selectable when denomination is Fiat. */
  fiatCurrencyCodes: string[];
};

function isZeroOrEmptyFeed(feed: string | null | undefined): boolean {
  if (feed == null || feed.trim() === "") return true;
  return feed.toLowerCase() === ZERO;
}

function normalizeToken(token: string): string {
  return token.trim().toLowerCase();
}

/**
 * Build settlement-asset and fiat-currency options for the FixedPrice open form.
 */
export function deriveFixedPriceOpenOptions(
  input: FixedPriceOpenOptionsInput,
): FixedPriceOpenOptions {
  if (!input.modeAvailable) {
    return {
      available: false,
      unavailableReason: FIXED_PRICE_MODE_UNAVAILABLE_REASON,
      assets: [],
      fiatCurrencyCodes: [],
    };
  }

  const assets: SettlementAssetOption[] = [
    {
      token: ZERO,
      label: input.native.label,
      decimals: input.native.decimals,
      assetDenomination: true,
      fiatDenomination: true,
    },
  ];

  for (const row of input.paymentTokens) {
    if (!row.active) continue;
    if (normalizeToken(row.token) === ZERO) continue;
    const hasFeed = !isZeroOrEmptyFeed(row.feed);
    assets.push({
      token: row.token,
      label: row.label,
      decimals: row.decimals,
      assetDenomination: true,
      fiatDenomination: hasFeed,
      ...(hasFeed
        ? {}
        : { fiatUnavailableReason: FIAT_TOKEN_FEED_REQUIRED_REASON }),
    });
  }

  const fiatCurrencyCodes: string[] = ["USD"];
  const seen = new Set(["USD"]);
  for (const row of input.currencyFeeds) {
    const code = row.currencyCode.trim().toUpperCase();
    if (!code || seen.has(code)) continue;
    if (code === "USD") continue;
    if (isZeroOrEmptyFeed(row.feed)) continue;
    seen.add(code);
    fiatCurrencyCodes.push(code);
  }

  return {
    available: true,
    assets,
    fiatCurrencyCodes,
  };
}

/** Whether Fiat is selectable for a chosen settlement asset. */
export function assetAllowsFiat(
  options: FixedPriceOpenOptions,
  token: string,
): boolean {
  const asset = options.assets.find(
    (a) => normalizeToken(a.token) === normalizeToken(token),
  );
  return asset?.fiatDenomination === true;
}

export function fiatUnavailableReasonForAsset(
  options: FixedPriceOpenOptions,
  token: string,
): string | undefined {
  const asset = options.assets.find(
    (a) => normalizeToken(a.token) === normalizeToken(token),
  );
  return asset?.fiatUnavailableReason;
}

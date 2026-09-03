/**
 * One derivation of openable / grantable commerce terms, parameterised by
 * selling mode. Answers which settlement assets, denominations, and
 * compensation forms are valid on a chain — used by granting and by opening.
 *
 * Inputs are injected (Ponder payment tokens + currency feeds + native
 * sentinel). Never reads chain ids or token address literals.
 *
 * FixedPrice P4: Fiat + ERC-20 requires a non-zero payment-token feed
 * (`PaymentTokenFeedRequired`). Ascending: asset denomination only (P1/N4).
 */

import {
  DENOMINATION_KIND,
  type CompensationForm,
  type DenominationKind,
} from "@/lib/commerce/denomination";
import type { CommerceMode } from "@/lib/commerce/mode";
import { COMPENSATION_FORM_DEFS } from "@/lib/commerce/compensation-form";

const ZERO = "0x0000000000000000000000000000000000000000";

/**
 * Fiat withheld because the network has no measured payment-token feed
 * (design-spec §4.16 quote asymmetry — stated, not omitted).
 */
export const FIAT_TOKEN_FEED_REQUIRED_REASON =
  "Fiat pricing needs a measured price feed, which this network does not have";

export const FIXED_PRICE_MODE_UNAVAILABLE_REASON =
  "Fixed-price selling is not available on this chain yet.";

export const ASCENDING_MODE_UNAVAILABLE_REASON =
  "Ascending selling is not available on this chain yet.";

/** Fail-closed when payment-token / feed config is unread or unreachable. */
export const COMMERCE_CONFIG_UNRESOLVED_REASON =
  "Settlement terms for this chain are not available yet.";

/** Ascending opens only under asset denomination (P1 ∩ N4 / M3). */
export const ASCENDING_ASSET_DENOMINATION_REQUIRED_REASON =
  "Ascending sales must be priced in the settlement asset.";

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

export type OpenableTermsInput = {
  mode: CommerceMode;
  modeAvailable: boolean;
  /**
   * False when Ponder (or other config source) failed or is unread.
   * Distinct from mode unavailable — never invent pairings.
   */
  configResolved: boolean;
  /** Native settlement — offered when mode + config allow. */
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

export type CompensationFormOption = {
  form: CompensationForm;
  available: true;
};

export type OpenableTerms = {
  available: boolean;
  unavailableReason?: string;
  assets: SettlementAssetOption[];
  /** Fiat ISO codes selectable when denomination is Fiat (fixed-price only). */
  fiatCurrencyCodes: string[];
  /** Both forms are always offered when terms are available. */
  compensationForms: CompensationFormOption[];
};

export type PairingSelection = {
  asset: string;
  denominationKind: DenominationKind;
  /** Required when denomination is Fiat. */
  currencyCode?: string;
};

export type PairingGate =
  | { available: true }
  | { available: false; cause: string };

function isZeroOrEmptyFeed(feed: string | null | undefined): boolean {
  if (feed == null || feed.trim() === "") return true;
  return feed.toLowerCase() === ZERO;
}

function normalizeToken(token: string): string {
  return token.trim().toLowerCase();
}

function modeUnavailableReason(mode: CommerceMode): string {
  return mode === "ascending"
    ? ASCENDING_MODE_UNAVAILABLE_REASON
    : FIXED_PRICE_MODE_UNAVAILABLE_REASON;
}

function emptyUnavailable(reason: string): OpenableTerms {
  return {
    available: false,
    unavailableReason: reason,
    assets: [],
    fiatCurrencyCodes: [],
    compensationForms: [],
  };
}

/**
 * Build settlement-asset, denomination, and compensation options for a mode.
 */
export function deriveOpenableTerms(input: OpenableTermsInput): OpenableTerms {
  if (!input.modeAvailable) {
    return emptyUnavailable(modeUnavailableReason(input.mode));
  }
  if (!input.configResolved) {
    return emptyUnavailable(COMMERCE_CONFIG_UNRESOLVED_REASON);
  }

  const ascending = input.mode === "ascending";

  const assets: SettlementAssetOption[] = [
    {
      token: ZERO,
      label: input.native.label,
      decimals: input.native.decimals,
      assetDenomination: true,
      fiatDenomination: !ascending,
      ...(ascending
        ? {
            fiatUnavailableReason: ASCENDING_ASSET_DENOMINATION_REQUIRED_REASON,
          }
        : {}),
    },
  ];

  for (const row of input.paymentTokens) {
    if (!row.active) continue;
    if (normalizeToken(row.token) === ZERO) continue;
    if (ascending) {
      assets.push({
        token: row.token,
        label: row.label,
        decimals: row.decimals,
        assetDenomination: true,
        fiatDenomination: false,
        fiatUnavailableReason: ASCENDING_ASSET_DENOMINATION_REQUIRED_REASON,
      });
      continue;
    }
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

  const fiatCurrencyCodes: string[] = [];
  if (!ascending) {
    fiatCurrencyCodes.push("USD");
    const seen = new Set(["USD"]);
    for (const row of input.currencyFeeds) {
      const code = row.currencyCode.trim().toUpperCase();
      if (!code || seen.has(code)) continue;
      if (code === "USD") continue;
      if (isZeroOrEmptyFeed(row.feed)) continue;
      seen.add(code);
      fiatCurrencyCodes.push(code);
    }
  }

  const compensationForms: CompensationFormOption[] = COMPENSATION_FORM_DEFS.map(
    (def) => ({ form: def.form, available: true as const }),
  );

  return {
    available: true,
    assets,
    fiatCurrencyCodes,
    compensationForms,
  };
}

/** Whether Fiat is selectable for a chosen settlement asset. */
export function assetAllowsFiat(
  options: OpenableTerms,
  token: string,
): boolean {
  const asset = options.assets.find(
    (a) => normalizeToken(a.token) === normalizeToken(token),
  );
  return asset?.fiatDenomination === true;
}

export function fiatUnavailableReasonForAsset(
  options: OpenableTerms,
  token: string,
): string | undefined {
  const asset = options.assets.find(
    (a) => normalizeToken(a.token) === normalizeToken(token),
  );
  return asset?.fiatUnavailableReason;
}

/**
 * Refuse a selection that opening would refuse — same named causes.
 * Fail closed when terms themselves are unavailable.
 */
export function gateOpenablePairing(
  options: OpenableTerms,
  selection: PairingSelection,
): PairingGate {
  if (!options.available) {
    return {
      available: false,
      cause: options.unavailableReason ?? COMMERCE_CONFIG_UNRESOLVED_REASON,
    };
  }

  const asset = options.assets.find(
    (a) => normalizeToken(a.token) === normalizeToken(selection.asset),
  );
  if (!asset) {
    return {
      available: false,
      cause: "Select a settlement asset available on this chain.",
    };
  }

  if (selection.denominationKind === DENOMINATION_KIND.Asset) {
    return { available: true };
  }

  // Fiat
  if (!asset.fiatDenomination) {
    return {
      available: false,
      cause: asset.fiatUnavailableReason ?? FIAT_TOKEN_FEED_REQUIRED_REASON,
    };
  }

  const code = (selection.currencyCode ?? "").trim().toUpperCase();
  if (!code) {
    return { available: false, cause: "Select a fiat currency." };
  }
  if (!options.fiatCurrencyCodes.includes(code)) {
    return {
      available: false,
      cause: "That fiat currency is not available for this mode on this chain.",
    };
  }

  return { available: true };
}

export function compensationFormAvailable(
  options: OpenableTerms,
  form: CompensationForm,
): boolean {
  if (!options.available) return false;
  return options.compensationForms.some((c) => c.form === form);
}

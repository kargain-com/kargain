import {
  isCryptoDisplayCurrency,
  type DisplayCurrency,
  type LegacyFiatCurrencyCode,
} from "@/lib/marketplace/currency-code";
import { CRYPTO_DISPLAY_CONFIG, type PartialFxRates } from "@/lib/marketplace/fx-rate-registry";
import { fiatCurrencySymbol } from "@/lib/marketplace/fiat-format";
import {
  displayAmountToUsd1e8,
  FIAT_SCALE,
  ratesReadyForPriceCurrency,
  usd1e8ToFiat1e8,
  type PriceCurrency,
} from "@/lib/marketplace/price-normalize";
import {
  FX_RATE_CHAIN_ID,
} from "@/lib/web3/chain-context";
import {
  nativeUnitOf,
  requireCommercialActive,
} from "@/lib/web3/commercial-active";
import type { CommercialNativeUnit } from "@/lib/web3/commercial-native-unit";
import {
  formatNativeAmount,
  formatNativeAmountLabeled,
  nativeAmountScale,
  parseNativeAmountRoundUp,
} from "@/lib/web3/native-amount";

function roundUpDivision(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) return 0n;
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  if (remainder === 0n) return quotient;
  return quotient + 1n;
}

/** Hub FX native unit — display-currency ETH ≡ hub commercial native. */
function hubNativeUnit(): CommercialNativeUnit {
  return nativeUnitOf(requireCommercialActive(FX_RATE_CHAIN_ID));
}

/** Parse decimal native string to base units; round up on nonzero fractional tail beyond decimals. */
export function parseEthAmountToWei(input: string): bigint | null {
  return parseNativeAmountRoundUp(input, hubNativeUnit());
}

function feeWeiToUsd1e8(
  feeWei: bigint,
  ethUsd: bigint,
  unit: CommercialNativeUnit,
): bigint | null {
  if (feeWei <= 0n || ethUsd <= 0n) return feeWei === 0n ? 0n : null;
  return (feeWei * ethUsd) / nativeAmountScale(unit);
}

function formatFiat1e8WithSymbol(value: bigint, symbol: string): string {
  const neg = value < 0n;
  const v = neg ? -value : value;
  const whole = v / FIAT_SCALE;
  const fracRaw = v % FIAT_SCALE;
  let frac2 = (fracRaw + 500_000n) / 1_000_000n;
  let wholePart = whole;
  if (frac2 === 100n) {
    wholePart += 1n;
    frac2 = 0n;
  }
  const core = `${wholePart.toLocaleString("en-US")}.${frac2.toString().padStart(2, "0")}`;
  const prefix = symbol.length === 1 ? symbol : `${symbol} `;
  return `${prefix}${neg ? `-${core}` : core}`;
}

function formatCryptoUnits(units: bigint, suffix: string, fracDigits: number): string {
  const neg = units < 0n;
  const v = neg ? -units : units;
  const config = Object.values(CRYPTO_DISPLAY_CONFIG).find((c) => c.suffix === suffix);
  const scale = config?.scale ?? 1n;
  const whole = v / scale;
  const fracRaw = v % scale;
  const fracDivisor = 10n ** BigInt(fracDigits);
  const fracScale = scale / fracDivisor;
  let frac = fracScale > 0n ? (fracRaw + fracScale / 2n) / fracScale : 0n;
  let wholePart = whole;
  if (frac >= fracDivisor) {
    wholePart += 1n;
    frac = 0n;
  }
  const core = `${wholePart.toString()}.${frac.toString().padStart(fracDigits, "0")}`;
  return `${neg ? `-${core}` : core} ${suffix}`;
}

/** Convert nav display-currency amount to fee wei (margin only; gas added at save). */
export function displayAmountToFeeWei(
  amount: string,
  displayCurrency: DisplayCurrency,
  rates: PartialFxRates,
): bigint | null {
  const trimmed = amount.trim();
  if (!trimmed || trimmed === "0") return 0n;

  const unit = hubNativeUnit();

  if (displayCurrency === "ETH") {
    const wei = parseNativeAmountRoundUp(trimmed, unit);
    return wei != null && wei >= 0n ? wei : null;
  }

  const usd1e8 = displayAmountToUsd1e8(trimmed, displayCurrency as PriceCurrency, rates);
  if (usd1e8 == null) return null;

  const ethUsd = rates.ethUsd;
  if (ethUsd == null || ethUsd <= 0n) return null;

  return roundUpDivision(usd1e8 * nativeAmountScale(unit), ethUsd);
}

/** Format stored fee wei for read-only display in nav display currency. */
export function formatFeeWeiInDisplayCurrency(
  feeWei: bigint,
  displayCurrency: DisplayCurrency,
  rates: PartialFxRates,
): string | null {
  if (feeWei === 0n) return "0";

  const unit = hubNativeUnit();

  if (displayCurrency === "ETH") {
    return formatNativeAmount(feeWei, unit);
  }

  const ethUsd = rates.ethUsd;
  if (ethUsd == null || ethUsd <= 0n) return null;

  const usd1e8 = feeWeiToUsd1e8(feeWei, ethUsd, unit);
  if (usd1e8 == null) return null;

  if (isCryptoDisplayCurrency(displayCurrency)) {
    const config = CRYPTO_DISPLAY_CONFIG[displayCurrency];
    const cryptoRate = rates[config.rateField];
    if (cryptoRate == null || cryptoRate <= 0n) return null;
    const units = (usd1e8 * config.scale) / cryptoRate;
    return formatCryptoUnits(units, config.suffix, config.fracDigits);
  }

  const fiatCode = displayCurrency as LegacyFiatCurrencyCode;
  const fiat1e8 = usd1e8ToFiat1e8(usd1e8, fiatCode, rates);
  if (fiat1e8 == null) return null;
  return formatFiat1e8WithSymbol(fiat1e8, fiatCurrencySymbol(fiatCode));
}

/** Mono native secondary line for fee readouts. */
export function formatFeeWeiEth(feeWei: bigint): string {
  return formatNativeAmountLabeled(feeWei, hubNativeUnit());
}

export function canComposeFeeInDisplayCurrency(
  displayCurrency: DisplayCurrency,
  rates: PartialFxRates,
): boolean {
  return ratesReadyForPriceCurrency(displayCurrency as PriceCurrency, rates);
}

export function composeTotalFeeWei(marginWei: bigint, gasWei: bigint | null): bigint {
  if (marginWei <= 0n) return 0n;
  return marginWei + (gasWei ?? 0n);
}

export function deriveMarginWeiFromOnChain(
  onChainFeeWei: bigint,
  gasWei: bigint | null,
): bigint {
  if (onChainFeeWei <= 0n) return 0n;
  if (gasWei == null) return onChainFeeWei;
  return onChainFeeWei > gasWei ? onChainFeeWei - gasWei : 0n;
}

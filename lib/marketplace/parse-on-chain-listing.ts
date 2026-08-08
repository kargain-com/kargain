import { getAddress, zeroAddress } from "viem";

import {
  DENOMINATION_KIND,
  type DenominationKind,
  parseDenominationKind,
} from "@/lib/commerce/denomination";
import {
  decodeCurrencyCode,
  legacyFiatFromCurrencyCode,
} from "@/lib/marketplace/currency-code";

export type OnChainListingRow = {
  seller: `0x${string}`;
  /** Raw consignment price (fiat 1e8 or asset units). */
  price: bigint;
  denominationKind: DenominationKind;
  asset: `0x${string}`;
  /** `bytes32` currency code from denomination (empty/zero when Asset). */
  currencyCode: string;
  /** Legacy fiat enum — meaningful when denomination is Fiat. */
  fiatCurrency: number;
  active: boolean;
};

function isZeroAddress(addr: string): boolean {
  try {
    return getAddress(addr) === zeroAddress;
  } catch {
    return true;
  }
}

function fiatCurrencyFromCode(currencyCode: unknown): number {
  if (typeof currencyCode !== "string" || !currencyCode.startsWith("0x")) {
    return 0;
  }
  return legacyFiatFromCurrencyCode(decodeCurrencyCode(currencyCode));
}

function asCurrencyCode(currencyCode: unknown): string {
  return typeof currencyCode === "string" ? currencyCode : "";
}

/** Active only when offered, real seller, and positive raw price. */
export function isListingRowActive(
  active: boolean,
  seller: string,
  price: bigint,
): boolean {
  if (!active) return false;
  if (isZeroAddress(seller)) return false;
  if (price <= 0n) return false;
  return true;
}

export type FixedPriceListingFields = {
  /** `ConsignmentPhase` — `Offered` (1) is the only listed phase. */
  phase: number | undefined;
  seller: string | undefined;
  price: bigint | undefined;
  /** `bytes32` currency code from `consignmentDenominationOf`. */
  currencyCode: unknown;
  denominationKind: DenominationKind | null | undefined;
  asset: string | undefined;
};

/**
 * Assemble the detail listing row from `FixedPriceConsignment` per-token
 * getters. Returns `null` while the phase read is unresolved so callers keep
 * commerce CTAs hidden (fail closed).
 */
export function buildOnChainListing(
  fields: FixedPriceListingFields,
): OnChainListingRow | null {
  if (fields.phase == null) return null;
  const denominationKind =
    fields.denominationKind === DENOMINATION_KIND.Asset ||
    fields.denominationKind === DENOMINATION_KIND.Fiat
      ? fields.denominationKind
      : DENOMINATION_KIND.Asset;
  const price = fields.price ?? 0n;
  const seller =
    (fields.seller as `0x${string}` | undefined) ?? zeroAddress;
  const asset = (() => {
    const raw = fields.asset?.trim();
    if (!raw) return zeroAddress;
    try {
      return getAddress(raw as `0x${string}`);
    } catch {
      return zeroAddress;
    }
  })();
  const currencyCode = asCurrencyCode(fields.currencyCode);
  return {
    seller,
    price,
    denominationKind,
    asset,
    currencyCode,
    fiatCurrency: fiatCurrencyFromCode(currencyCode),
    active: isListingRowActive(fields.phase === 1, seller, price),
  };
}

/**
 * Decode a legacy escrow-shaped listing tuple. Retained for Ponder-sourced
 * rows and tests; chain reads go through `buildOnChainListing`.
 * Legacy rows are treated as Fiat (historical MarketplaceEscrow).
 */
export function parseOnChainListing(raw: unknown): OnChainListingRow | null {
  if (raw == null) return null;

  if (typeof raw === "object" && !Array.isArray(raw) && "seller" in raw) {
    const o = raw as {
      seller: `0x${string}`;
      fiatPrice1e8?: bigint;
      price?: bigint;
      active: boolean;
      currencyCode?: string;
      denominationKind?: number;
      asset?: string;
    };
    const price = BigInt(o.price ?? o.fiatPrice1e8 ?? 0n);
    const denominationKind =
      parseDenominationKind(o.denominationKind) ?? DENOMINATION_KIND.Fiat;
    let asset: `0x${string}` = zeroAddress;
    if (o.asset) {
      try {
        asset = getAddress(o.asset as `0x${string}`);
      } catch {
        asset = zeroAddress;
      }
    }
    const currencyCode = asCurrencyCode(o.currencyCode);
    return {
      seller: o.seller,
      price,
      denominationKind,
      asset,
      currencyCode,
      fiatCurrency: fiatCurrencyFromCode(currencyCode),
      active: isListingRowActive(Boolean(o.active), o.seller, price),
    };
  }

  if (Array.isArray(raw) && raw.length >= 3) {
    const seller = raw[0] as `0x${string}`;
    const price = BigInt(raw[1] as bigint);
    const currencyCode = asCurrencyCode(raw[6]);
    return {
      seller,
      price,
      denominationKind: DENOMINATION_KIND.Fiat,
      asset: zeroAddress,
      currencyCode,
      fiatCurrency: fiatCurrencyFromCode(currencyCode),
      active: isListingRowActive(Boolean(raw[2]), seller, price),
    };
  }

  return null;
}

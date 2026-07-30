import { getAddress, zeroAddress } from "viem";

import {
  decodeCurrencyCode,
  legacyFiatFromCurrencyCode,
} from "@/lib/marketplace/currency-code";

export type OnChainListingRow = {
  seller: `0x${string}`;
  fiatPrice1e8: bigint;
  /** Legacy fiat enum for display and API (0–10; see LEGACY_FIAT_CURRENCIES). */
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

/** Active only when chain flag is set and row has a real seller and price. */
export function isListingRowActive(
  active: boolean,
  seller: string,
  fiatPrice1e8: bigint,
): boolean {
  if (!active) return false;
  if (isZeroAddress(seller)) return false;
  if (fiatPrice1e8 <= 0n) return false;
  return true;
}

function toRow(
  seller: `0x${string}`,
  fiatPrice1e8: bigint,
  active: boolean,
  currencyCode?: unknown,
): OnChainListingRow {
  return {
    seller,
    fiatPrice1e8,
    fiatCurrency: fiatCurrencyFromCode(currencyCode),
    active: isListingRowActive(active, seller, fiatPrice1e8),
  };
}

export type FixedPriceListingFields = {
  /** `ConsignmentPhase` — `Offered` (1) is the only listed phase. */
  phase: number | undefined;
  seller: string | undefined;
  price: bigint | undefined;
  /** `bytes32` currency code from `consignmentDenominationOf`. */
  currencyCode: unknown;
};

/**
 * Assemble the browse/detail listing row from `FixedPriceConsignment`
 * per-token getters. Returns `null` while the phase read is unresolved so
 * callers keep commerce CTAs hidden (fail closed).
 */
export function buildOnChainListing(
  fields: FixedPriceListingFields,
): OnChainListingRow | null {
  if (fields.phase == null) return null;
  return toRow(
    (fields.seller as `0x${string}` | undefined) ?? zeroAddress,
    fields.price ?? 0n,
    fields.phase === 1,
    fields.currencyCode,
  );
}

/**
 * Decode a legacy escrow-shaped listing tuple. Retained for Ponder-sourced
 * rows and tests; chain reads go through `buildOnChainListing`.
 */
export function parseOnChainListing(raw: unknown): OnChainListingRow | null {
  if (raw == null) return null;

  if (typeof raw === "object" && !Array.isArray(raw) && "seller" in raw) {
    const o = raw as {
      seller: `0x${string}`;
      fiatPrice1e8: bigint;
      active: boolean;
      currencyCode?: string;
    };
    return toRow(o.seller, BigInt(o.fiatPrice1e8), Boolean(o.active), o.currencyCode);
  }

  if (Array.isArray(raw) && raw.length >= 3) {
    return toRow(
      raw[0] as `0x${string}`,
      BigInt(raw[1] as bigint),
      Boolean(raw[2]),
      raw[6],
    );
  }

  return null;
}

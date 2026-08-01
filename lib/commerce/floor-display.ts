/**
 * Display units for a snapshotted consignment floor — fiat 1e8 or asset
 * decimals. ERC-20 decimals are injected (caller reads chain when needed).
 */

import {
  DENOMINATION_KIND,
  FIAT_PRICE_DECIMALS,
  decodeCurrencyCode,
  type DenominationKind,
} from "@/lib/commerce/denomination";
import { isZeroAddress } from "@/lib/commerce/consignment";

export type FloorDisplayUnits = {
  decimals: number;
  unitLabel: string;
};

/**
 * Resolve floor display units. When asset-denominated and non-native, pass
 * `erc20Decimals` from a successful chain read; omit while unread so the
 * concession surface stays fail-closed.
 */
export function floorDisplayUnits(input: {
  denominationKind: DenominationKind | undefined;
  currencyCode?: string | null;
  asset?: string | null;
  /** Required when denomination is Asset and asset is a non-zero ERC-20. */
  erc20Decimals?: number | null;
  /** Label when asset is native (default ETH) or for ERC-20 when known. */
  assetLabel?: string;
}): FloorDisplayUnits | null {
  if (input.denominationKind === undefined) return null;

  if (input.denominationKind === DENOMINATION_KIND.Fiat) {
    const code =
      typeof input.currencyCode === "string" &&
      input.currencyCode.startsWith("0x")
        ? decodeCurrencyCode(input.currencyCode)
        : (input.currencyCode ?? "").trim();
    return {
      decimals: FIAT_PRICE_DECIMALS,
      unitLabel: code || "USD",
    };
  }

  const asset = input.asset ?? "";
  if (!asset || isZeroAddress(asset)) {
    return {
      decimals: 18,
      unitLabel: input.assetLabel ?? "ETH",
    };
  }

  if (input.erc20Decimals == null || !Number.isFinite(input.erc20Decimals)) {
    return null;
  }
  return {
    decimals: input.erc20Decimals,
    unitLabel: input.assetLabel ?? "token",
  };
}

/**
 * Display units for a snapshotted consignment floor — fiat 1e8 or asset
 * decimals. ERC-20 decimals are injected (caller reads chain when needed).
 * Native decimals/label come from {@link CommercialNativeUnit} (S8-4).
 */

import {
  DENOMINATION_KIND,
  FIAT_PRICE_DECIMALS,
  decodeCurrencyCode,
  type DenominationKind,
} from "@/lib/commerce/denomination";
import { isZeroAddress } from "@/lib/commerce/consignment";
import type { CommercialNativeUnit } from "@/lib/web3/commercial-native-unit";

export type FloorDisplayUnits = {
  decimals: number;
  unitLabel: string;
};

/**
 * Resolve floor display units. When asset-denominated and non-native, pass
 * `erc20Decimals` from a successful chain read; omit while unread so the
 * concession surface stays fail-closed.
 * Native asset requires `nativeUnit` from the commercial stack.
 */
export function floorDisplayUnits(input: {
  denominationKind: DenominationKind | undefined;
  currencyCode?: string | null;
  asset?: string | null;
  /** Required when denomination is Asset and asset is a non-zero ERC-20. */
  erc20Decimals?: number | null;
  /** Native unit from the commercial stack (required for native asset floors). */
  nativeUnit?: CommercialNativeUnit | null;
  /** Label for ERC-20 when known (ignored for native — use nativeUnit.symbol). */
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
    if (!input.nativeUnit) return null;
    return {
      decimals: input.nativeUnit.decimals,
      unitLabel: input.nativeUnit.symbol,
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

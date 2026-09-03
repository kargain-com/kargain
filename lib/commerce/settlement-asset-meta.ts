/**
 * Sole resolver for settlement-asset display identity (native / USDC / unknown).
 * Openable-terms labels, listing asking price, and auction ETH|USDC wrappers
 * consume this — never invent a second address→symbol map in UI.
 *
 * Native symbol/decimals come from the commercial stack's nativeUnit (S8-4).
 */

import { getAddress, zeroAddress } from "viem";

import {
  commercialActive,
  nativeUnitOf,
} from "@/lib/web3/commercial-active";
import { usdcAddress } from "@/lib/web3/deployment-addresses";
import { shortAddress } from "@/lib/web3/wallet-display";

export type SettlementAssetIdentity = "native" | "usdc" | "unknown";

export type SettlementAssetMeta = {
  /** UI unit label: ETH / USDC / short address for unknown admits. */
  label: string;
  /** Known decimals, or null when the token is not in the registry. */
  decimals: number | null;
  identity: SettlementAssetIdentity;
};

function isZero(asset: string): boolean {
  try {
    return getAddress(asset as `0x${string}`) === zeroAddress;
  } catch {
    return true;
  }
}

/**
 * Resolve label + decimals for a settlement asset on a chain.
 * Unknown ERC-20s stay fail-visible (`shortAddress`, decimals null).
 * Native on a non-commercial chainId → unknown (no invented ETH/18).
 */
export function resolveSettlementAssetMeta(input: {
  chainId: number;
  asset: string | null | undefined;
}): SettlementAssetMeta {
  const raw = input.asset?.trim() ?? "";
  if (!raw || isZero(raw)) {
    const stack = commercialActive(input.chainId);
    if (!stack) {
      return {
        label: shortAddress(raw || zeroAddress),
        decimals: null,
        identity: "unknown",
      };
    }
    const unit = nativeUnitOf(stack);
    return {
      label: unit.symbol,
      decimals: unit.decimals,
      identity: "native",
    };
  }

  let checksummed: `0x${string}`;
  try {
    checksummed = getAddress(raw as `0x${string}`);
  } catch {
    return {
      label: shortAddress(raw),
      decimals: null,
      identity: "unknown",
    };
  }

  const usdc = usdcAddress(input.chainId);
  if (usdc) {
    try {
      if (getAddress(usdc) === checksummed) {
        return { label: "USDC", decimals: 6, identity: "usdc" };
      }
    } catch {
      // fall through to unknown
    }
  }

  return {
    label: shortAddress(checksummed),
    decimals: null,
    identity: "unknown",
  };
}

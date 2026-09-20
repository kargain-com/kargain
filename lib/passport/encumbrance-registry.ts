/**
 * Pure normalization of the KarPassport encumbrance registry views (S8-D1b).
 * Membership is per passport contract / chain — never invent members.
 * Shape is CommerceFact — known sources | pending | refused(cause).
 */

import { getAddress, isAddress, type Address } from "viem";

import {
  commerceFactKnown,
  commerceFactPending,
  commerceFactRefused,
  type CommerceFact,
  type SurfaceSupportCause,
} from "@/lib/passport/commerce-fact";
import type { KeyedEntry } from "@/lib/web3/keyed-multicall";

/** Matches `KarPassport.MAX_ENCUMBRANCE_SOURCES`. */
export const MAX_ENCUMBRANCE_SOURCES = 8;

/** Registry membership as a commerce fact. */
export type EncumbranceRegistry = CommerceFact<readonly Address[]>;

/**
 * Build registry membership from keyed `encumbranceSourceCount` +
 * `encumbranceSourceAt(0..7)` entries. Out-of-range At failures are omitted.
 */
export function deriveEncumbranceRegistry(input: {
  countEntry: KeyedEntry | undefined;
  atEntries: readonly (KeyedEntry | undefined)[];
}): EncumbranceRegistry {
  const { countEntry, atEntries } = input;
  if (countEntry == null) {
    return commerceFactPending();
  }
  switch (countEntry.status) {
    case "pending":
      return commerceFactPending();
    case "refused":
      return commerceFactRefused(countEntry.cause);
    case "success":
      break;
    default: {
      const _exhaustive: never = countEntry;
      return _exhaustive;
    }
  }

  const rawCount = countEntry.result;
  const count =
    typeof rawCount === "bigint"
      ? Number(rawCount)
      : typeof rawCount === "number"
        ? rawCount
        : Number(rawCount);
  if (!Number.isFinite(count) || count < 0) {
    return commerceFactRefused("malformed_response");
  }

  const n = Math.min(count, MAX_ENCUMBRANCE_SOURCES);
  const sources: Address[] = [];
  for (let i = 0; i < n; i++) {
    const entry = atEntries[i];
    if (entry == null || entry.status !== "success") continue;
    const raw = entry.result;
    if (typeof raw !== "string" || !isAddress(raw)) continue;
    sources.push(getAddress(raw));
  }
  return commerceFactKnown(sources);
}

/** Registry from a surfaceSupport refusal — never pending. */
export function encumbranceRegistryFromSupport(
  cause: SurfaceSupportCause,
): EncumbranceRegistry {
  return commerceFactRefused(cause);
}

/** True when `source` is in the known registry list (checksum-normalized). */
export function isRegisteredEncumbranceSource(
  registry: EncumbranceRegistry,
  source: Address,
): boolean {
  if (registry.status !== "known") return false;
  const needle = getAddress(source);
  return registry.value.some((s) => s === needle);
}

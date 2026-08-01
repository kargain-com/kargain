/**
 * Pure normalization of the KarPassport encumbrance registry views.
 * Membership is per passport contract / chain — never invent members.
 */

import { getAddress, isAddress, type Address } from "viem";

import type { KeyedEntry } from "@/lib/web3/keyed-multicall";

/** Matches `KarPassport.MAX_ENCUMBRANCE_SOURCES`. */
export const MAX_ENCUMBRANCE_SOURCES = 8;

export type EncumbranceRegistry = {
  /** Ordered sources when the count read succeeded. */
  readonly sources: readonly Address[];
  /** True while count is unread or failed — fail closed (show nothing invented). */
  readonly unresolved: boolean;
};

/**
 * Build registry membership from keyed `encumbranceSourceCount` +
 * `encumbranceSourceAt(0..7)` entries. Out-of-range At failures are omitted.
 */
export function deriveEncumbranceRegistry(input: {
  countEntry: KeyedEntry | undefined;
  atEntries: readonly (KeyedEntry | undefined)[];
}): EncumbranceRegistry {
  const { countEntry, atEntries } = input;
  if (countEntry == null || countEntry.status !== "success") {
    return { sources: [], unresolved: true };
  }

  const rawCount = countEntry.result;
  const count =
    typeof rawCount === "bigint"
      ? Number(rawCount)
      : typeof rawCount === "number"
        ? rawCount
        : Number(rawCount);
  if (!Number.isFinite(count) || count < 0) {
    return { sources: [], unresolved: true };
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
  return { sources, unresolved: false };
}

/** True when `source` is in the registry list (checksum-normalized). */
export function isRegisteredEncumbranceSource(
  registry: EncumbranceRegistry,
  source: Address,
): boolean {
  if (registry.unresolved) return false;
  const needle = getAddress(source);
  return registry.sources.some((s) => s === needle);
}

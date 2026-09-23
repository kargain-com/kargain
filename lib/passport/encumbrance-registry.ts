/**
 * Pure normalization of the KarPassport encumbrance registry views (S8-D1b / 9.3b).
 * Membership is per passport contract / chain — never invent members.
 * Shape is CommerceFact — known sources | pending | refused(cause).
 * Members are {@link ProtocolOwner} (EIP-155 checksum or SVM program base58).
 */

import { getAddress, isAddress } from "viem";

import {
  commerceFactKnown,
  commerceFactPending,
  commerceFactRefused,
  type CommerceFact,
  type SurfaceSupportCause,
} from "@/lib/passport/commerce-fact";
import type { KeyedEntry } from "@/lib/web3/keyed-multicall";
import {
  mintProtocolOwner,
  protocolAddressesEqual,
  type ProtocolOwner,
} from "@/lib/web3/protocol-address";

/** Matches `KarPassport.MAX_ENCUMBRANCE_SOURCES`. */
export const MAX_ENCUMBRANCE_SOURCES = 8;

/** Registry membership as a commerce fact. */
export type EncumbranceRegistry = CommerceFact<readonly ProtocolOwner[]>;

/**
 * Build registry membership from keyed `encumbranceSourceCount` +
 * `encumbranceSourceAt(0..7)` entries. Out-of-range At failures are omitted.
 * `namespace` mints each member as {@link ProtocolOwner}.
 */
export function deriveEncumbranceRegistry(input: {
  namespace: number;
  countEntry: KeyedEntry | undefined;
  atEntries: readonly (KeyedEntry | undefined)[];
}): EncumbranceRegistry {
  const { namespace, countEntry, atEntries } = input;
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
  const sources: ProtocolOwner[] = [];
  for (let i = 0; i < n; i++) {
    const entry = atEntries[i];
    if (entry == null || entry.status !== "success") continue;
    const raw = entry.result;
    if (typeof raw !== "string" || !isAddress(raw)) continue;
    const minted = mintProtocolOwner(namespace, getAddress(raw));
    if (minted != null) sources.push(minted);
  }
  return commerceFactKnown(sources);
}

/**
 * Registry from decoded PassportConfig encumbrance sources (SVM).
 * Empty list is a valid known fact; callers must not invent empty on absent config.
 */
export function encumbranceRegistryFromProgramIds(input: {
  namespace: number;
  programIds: readonly string[];
}): EncumbranceRegistry {
  const sources: ProtocolOwner[] = [];
  for (const id of input.programIds) {
    const minted = mintProtocolOwner(input.namespace, id);
    if (minted == null) {
      return commerceFactRefused("malformed_response");
    }
    sources.push(minted);
  }
  return commerceFactKnown(sources);
}

/** Registry from a surfaceSupport refusal — never pending. */
export function encumbranceRegistryFromSupport(
  cause: SurfaceSupportCause,
): EncumbranceRegistry {
  return commerceFactRefused(cause);
}

/** True when `source` is in the known registry list (namespace-normalized). */
export function isRegisteredEncumbranceSource(
  registry: EncumbranceRegistry,
  source: string,
  namespace: number,
): boolean {
  if (registry.status !== "known") return false;
  return registry.value.some((s) =>
    protocolAddressesEqual(namespace, s, source),
  );
}

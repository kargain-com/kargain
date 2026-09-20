"use client";

/**
 * Sole owner of wagmi `useReadContracts` and the SVM batch-read sibling (S8-3 / U7 / S8-D1a).
 * Consumers address results by named key — never by ordinal position.
 * SVM arm shares TanStack Query cache across mounts (EVM parity); honors enabled/staleTime.
 * Entries are success | pending | refused(cause) — wait and refusal are never the same value.
 * Import ban: `test/keyed-multicall-policy.test.ts`.
 */

import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import type { Abi, Address } from "viem";
import { useReadContracts } from "wagmi";

import type { FetchSvmAccountDataCause } from "@/lib/web3/svm-rpc";
import { createProductSvmKeyedAccountSource } from "@/lib/web3/svm-rpc";
import {
  resolveSvmKeyedReads,
  type SvmKeyedAccountSource,
  type SvmKeyedReadEntry,
} from "@/lib/web3/svm-keyed-read";

export type KeyedEvmContract<K extends string = string> = {
  key: K;
  address: Address;
  abi: Abi;
  functionName: string;
  args?: readonly unknown[];
  chainId: number;
};

export type KeyedSvmContract<K extends string = string> = {
  key: K;
  vm: "svm";
  account: string;
};

export type KeyedContract<K extends string = string> =
  | KeyedEvmContract<K>
  | KeyedSvmContract<K>;

/**
 * Closed refusal causes for keyed reads.
 * SVM causes are {@link FetchSvmAccountDataCause} — one source, not restated.
 */
export type KeyedReadCause =
  | FetchSvmAccountDataCause
  | "unresolved_namespace"
  | "evm_call_failed";

export type KeyedEntry =
  | { status: "success"; result: unknown }
  | { status: "pending" }
  | { status: "refused"; cause: KeyedReadCause; error?: Error };

type WagmiReadEntry =
  | { status: "success"; result: unknown }
  | { status: "failure"; error: Error };

function isSvmContract<K extends string>(
  c: KeyedContract<K>,
): c is KeyedSvmContract<K> {
  return "vm" in c && c.vm === "svm";
}

/** Pure: map one wagmi slot. Null while the batch is still in flight → pending. */
export function wagmiSlotToKeyedEntry(
  raw: WagmiReadEntry | undefined,
  batchPending: boolean,
): KeyedEntry | undefined {
  if (raw == null) {
    return batchPending ? { status: "pending" } : undefined;
  }
  if (raw.status === "success") {
    return { status: "success", result: raw.result };
  }
  return {
    status: "refused",
    cause: "evm_call_failed",
    error: raw.error,
  };
}

/** Pure: map resolveSvmKeyedReads entries onto KeyedEntry (no pending — that is RQ). */
export function svmResolvedEntryToKeyedEntry(
  entry: SvmKeyedReadEntry,
): KeyedEntry {
  if (entry.status === "success") {
    return { status: "success", result: entry.result };
  }
  return { status: "refused", cause: entry.cause };
}

/**
 * Pure: one KeyedEntry per contract from a per-account map.
 * Missing RQ data → pending for every key (never a refusal).
 */
export function svmEntriesFromAccountMap(
  contracts: readonly { account: string }[],
  byAccount: Record<string, KeyedEntry> | undefined,
): KeyedEntry[] {
  const pendingEntry: KeyedEntry = { status: "pending" };
  return contracts.map((c) => {
    if (byAccount == null) return pendingEntry;
    return (
      byAccount[c.account] ?? {
        status: "refused" as const,
        cause: "account_not_found" as const,
      }
    );
  });
}

function buildKeyMap<K extends string>(
  contracts: readonly KeyedContract<K>[],
  data: readonly (KeyedEntry | undefined)[],
): Map<K, KeyedEntry> {
  const map = new Map<K, KeyedEntry>();
  for (let i = 0; i < contracts.length; i++) {
    const entry = data[i];
    if (entry != null) map.set(contracts[i].key, entry);
  }
  return map;
}

export type KeyedReadContractsResult<K extends string> = {
  /** Full entry; refused keeps `error` reachable for SourceUnanswerable (EVM). */
  entry: (key: K) => KeyedEntry | undefined;
  /** Success payload only; missing/pending/refused → `undefined` (never coerce boolean). */
  get: (key: K) => unknown | undefined;
  asBigint: (key: K) => bigint | undefined;
  asNumber: (key: K) => number | undefined;
  asString: (key: K) => string | undefined;
  /** Declaration-order entries for aggregators (`.some` / `.every`). */
  entries: readonly (KeyedEntry | undefined)[];
  isPending: boolean;
  isFetching: boolean;
  isLoading: boolean;
  refetch: () => Promise<{
    get: (key: K) => unknown | undefined;
    entry: (key: K) => KeyedEntry | undefined;
  }>;
};

function resultApi<K extends string>(
  contracts: readonly KeyedContract<K>[],
  byKey: Map<K, KeyedEntry>,
  entries: readonly (KeyedEntry | undefined)[],
  flags: { isPending: boolean; isFetching: boolean; isLoading: boolean },
  refetch: KeyedReadContractsResult<K>["refetch"],
): KeyedReadContractsResult<K> {
  const entry = (key: K): KeyedEntry | undefined => byKey.get(key);

  const get = (key: K): unknown | undefined => {
    const e = byKey.get(key);
    return e?.status === "success" ? e.result : undefined;
  };

  const asBigint = (key: K): bigint | undefined => {
    const raw = get(key);
    if (raw == null) return undefined;
    return typeof raw === "bigint" ? raw : BigInt(raw as number | string);
  };

  const asNumber = (key: K): number | undefined => {
    const raw = get(key);
    return raw == null ? undefined : Number(raw);
  };

  const asString = (key: K): string | undefined => {
    const raw = get(key);
    return typeof raw === "string" ? raw : undefined;
  };

  return {
    entry,
    get,
    asBigint,
    asNumber,
    asString,
    entries,
    ...flags,
    refetch,
  };
}

function mapSvmEntries(
  resolved: Awaited<ReturnType<typeof resolveSvmKeyedReads>>,
): KeyedEntry[] {
  return resolved.entries.map(svmResolvedEntryToKeyedEntry);
}

/** Stable RQ key: sorted unique accounts so identical PassportState mounts share one fetch. */
export function svmKeyedReadQueryKey(
  accounts: readonly string[],
): readonly ["svm-keyed-reads", ...string[]] {
  const unique = [...new Set(accounts)].sort();
  return ["svm-keyed-reads", ...unique];
}

/**
 * One multicall per batch. Conditional membership = omit named entries;
 * repeated groups = composite keys — never index or stride arithmetic.
 *
 * EVM batches use wagmi. SVM batches use {@link resolveSvmKeyedReads}
 * via TanStack Query (product default = live svm-rpc source; explicit `null` →
 * unresolved_namespace). Same account set → one in-flight / cached network trip.
 */
export function useKeyedReadContracts<const T extends readonly KeyedContract[]>(opts: {
  contracts: T;
  query?: {
    enabled?: boolean;
    staleTime?: number;
    gcTime?: number;
  };
  allowFailure?: boolean;
  /**
   * SVM account source. Omit → product live RPC source.
   * Pass `null` → every entry refused `unresolved_namespace` (tests).
   * Pass an object → inject (tests / future domain owners).
   */
  svmAccountSource?: SvmKeyedAccountSource | null;
}): KeyedReadContractsResult<T[number]["key"]> {
  type K = T[number]["key"];
  const { contracts, query, allowFailure, svmAccountSource } = opts;

  const svmCount = contracts.filter(isSvmContract).length;
  const isSvmBatch = svmCount > 0;
  if (isSvmBatch && svmCount !== contracts.length) {
    throw new Error("keyed-multicall: refuse mixed EVM/SVM batches");
  }

  const wagmiContracts = isSvmBatch
    ? []
    : contracts.map((c) => {
        const evm = c as KeyedEvmContract<K>;
        return {
          address: evm.address,
          abi: evm.abi,
          functionName: evm.functionName,
          args: evm.args,
          chainId: evm.chainId,
        };
      });

  const enabled = (query?.enabled ?? true) && !isSvmBatch;

  const {
    data,
    isPending,
    isFetching,
    isLoading,
    refetch,
  } = useReadContracts({
    contracts: wagmiContracts,
    allowFailure,
    query: { ...query, enabled },
  });

  const productSource = useMemo(
    () => (isSvmBatch ? createProductSvmKeyedAccountSource() : null),
    [isSvmBatch],
  );

  const effectiveSource: SvmKeyedAccountSource | null | undefined =
    svmAccountSource !== undefined
      ? svmAccountSource
      : (productSource ?? undefined);

  const svmRequests = useMemo(() => {
    if (!isSvmBatch) return null;
    return (contracts as readonly KeyedSvmContract<K>[]).map((c) => ({
      key: c.key,
      account: c.account,
    }));
  }, [contracts, isSvmBatch]);

  const svmAccounts = useMemo(
    () => (svmRequests == null ? [] : svmRequests.map((r) => r.account)),
    [svmRequests],
  );

  const svmQueryKey = useMemo(
    () => svmKeyedReadQueryKey(svmAccounts),
    [svmAccounts],
  );

  const svmQueryEnabled =
    isSvmBatch && (query?.enabled ?? true) && svmRequests != null;

  const {
    data: svmByAccount,
    isPending: svmIsPending,
    isFetching: svmIsFetching,
    isLoading: svmIsLoading,
    refetch: refetchSvmQuery,
  } = useQuery({
    queryKey: svmQueryKey,
    queryFn: async (): Promise<Record<string, KeyedEntry>> => {
      const unique = [...new Set(svmAccounts)].sort();
      const resolved = await resolveSvmKeyedReads(
        unique.map((account) => ({ key: account, account })),
        effectiveSource,
      );
      const mapped = mapSvmEntries(resolved);
      const byAccount: Record<string, KeyedEntry> = {};
      for (let i = 0; i < unique.length; i++) {
        byAccount[unique[i]!] = mapped[i]!;
      }
      return byAccount;
    },
    enabled: svmQueryEnabled,
    staleTime: query?.staleTime,
    gcTime: query?.gcTime,
  });

  const entriesFromAccountMap = useCallback(
    (byAccount: Record<string, KeyedEntry> | undefined): KeyedEntry[] =>
      svmEntriesFromAccountMap(
        contracts as readonly KeyedSvmContract<K>[],
        byAccount,
      ),
    [contracts],
  );

  const refetchSvm = useCallback(async () => {
    if (!isSvmBatch || svmRequests == null) {
      return {
        get: (_key: K) => undefined as unknown | undefined,
        entry: (_key: K) => undefined as KeyedEntry | undefined,
      };
    }
    const result = await refetchSvmQuery();
    const fresh = entriesFromAccountMap(result.data);
    const map = buildKeyMap(
      contracts as readonly KeyedContract<K>[],
      fresh,
    );
    return {
      get: (key: K) => {
        const e = map.get(key);
        return e?.status === "success" ? e.result : undefined;
      },
      entry: (key: K) => map.get(key),
    };
  }, [
    isSvmBatch,
    svmRequests,
    refetchSvmQuery,
    contracts,
    entriesFromAccountMap,
  ]);

  if (isSvmBatch) {
    const keyedEntries = entriesFromAccountMap(svmByAccount);
    const byKey = buildKeyMap(
      contracts as readonly KeyedContract<K>[],
      keyedEntries,
    );
    const pending = svmQueryEnabled
      ? svmIsPending || svmByAccount == null
      : false;
    return resultApi(
      contracts as readonly KeyedContract<K>[],
      byKey,
      keyedEntries,
      {
        isPending: pending,
        isFetching: svmQueryEnabled ? svmIsFetching : false,
        isLoading: svmQueryEnabled ? svmIsLoading || pending : false,
      },
      refetchSvm,
    );
  }

  const results = data as readonly WagmiReadEntry[] | undefined;
  const keyedFromWagmi = (contracts as readonly KeyedContract<K>[]).map((_, i) =>
    wagmiSlotToKeyedEntry(results?.[i], isPending),
  );
  const byKey = buildKeyMap(
    contracts as readonly KeyedContract<K>[],
    keyedFromWagmi,
  );

  return resultApi(
    contracts as readonly KeyedContract<K>[],
    byKey,
    keyedFromWagmi,
    { isPending, isFetching, isLoading },
    async () => {
      const result = await refetch();
      const fresh = result.data as readonly WagmiReadEntry[] | undefined;
      const mapped = (contracts as readonly KeyedContract<K>[]).map((_, i) =>
        wagmiSlotToKeyedEntry(fresh?.[i], false),
      );
      const map = buildKeyMap(
        contracts as readonly KeyedContract<K>[],
        mapped,
      );
      return {
        get: (key: K): unknown | undefined => {
          const e = map.get(key);
          return e?.status === "success" ? e.result : undefined;
        },
        entry: (key: K): KeyedEntry | undefined => map.get(key),
      };
    },
  );
}

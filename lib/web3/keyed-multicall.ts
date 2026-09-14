"use client";

/**
 * Sole owner of wagmi `useReadContracts` and the SVM batch-read sibling (S8-3 / U7).
 * Consumers address results by named key — never by ordinal position.
 * Import ban: `test/keyed-multicall-policy.test.ts`.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Abi, Address } from "viem";
import { useReadContracts } from "wagmi";

import { createProductSvmKeyedAccountSource } from "@/lib/web3/svm-rpc";
import {
  resolveSvmKeyedReads,
  type SvmKeyedAccountSource,
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

export type KeyedEntry =
  | { status: "success"; result: unknown }
  | { status: "failure"; error: Error };

type WagmiReadEntry =
  | { status: "success"; result: unknown }
  | { status: "failure"; error: Error };

function isSvmContract<K extends string>(
  c: KeyedContract<K>,
): c is KeyedSvmContract<K> {
  return "vm" in c && c.vm === "svm";
}

function toKeyedEntry(raw: WagmiReadEntry | undefined): KeyedEntry | undefined {
  if (raw == null) return undefined;
  if (raw.status === "success") {
    return { status: "success", result: raw.result };
  }
  return { status: "failure", error: raw.error };
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
  /** Full entry; failure keeps `error` reachable for later SourceUnanswerable. */
  entry: (key: K) => KeyedEntry | undefined;
  /** Success payload only; missing/failure → `undefined` (never coerce boolean). */
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
  return resolved.entries.map((e) =>
    e.status === "success"
      ? { status: "success", result: e.result }
      : { status: "failure", error: e.error },
  );
}

/**
 * One multicall per batch. Conditional membership = omit named entries;
 * repeated groups = composite keys — never index or stride arithmetic.
 *
 * EVM batches use wagmi. SVM batches use {@link resolveSvmKeyedReads}
 * (product default = live svm-rpc source; explicit `null` → unresolved_namespace).
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
   * Pass `null` → every entry fails `unresolved_namespace` (tests).
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

  const { data, isPending, isFetching, isLoading, refetch } = useReadContracts({
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

  const svmRequestKey = useMemo(
    () => (svmRequests == null ? null : JSON.stringify(svmRequests)),
    [svmRequests],
  );

  const [svmSnapshot, setSvmSnapshot] = useState<{
    key: string;
    entries: KeyedEntry[];
  } | null>(null);
  const [svmFetchEpoch, setSvmFetchEpoch] = useState(0);

  useEffect(() => {
    if (!isSvmBatch || svmRequests == null || svmRequestKey == null) {
      return;
    }
    let cancelled = false;
    const key = svmRequestKey;
    void resolveSvmKeyedReads(svmRequests, effectiveSource).then((resolved) => {
      if (cancelled) return;
      setSvmSnapshot({ key, entries: mapSvmEntries(resolved) });
    });
    return () => {
      cancelled = true;
    };
  }, [isSvmBatch, svmRequests, svmRequestKey, effectiveSource, svmFetchEpoch]);

  const refetchSvm = useCallback(async () => {
    if (!isSvmBatch || svmRequests == null || svmRequestKey == null) {
      return {
        get: (_key: K) => undefined as unknown | undefined,
        entry: (_key: K) => undefined as KeyedEntry | undefined,
      };
    }
    const again = await resolveSvmKeyedReads(svmRequests, effectiveSource);
    const fresh = mapSvmEntries(again);
    setSvmSnapshot({ key: svmRequestKey, entries: fresh });
    setSvmFetchEpoch((n) => n + 1);
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
  }, [isSvmBatch, svmRequests, svmRequestKey, effectiveSource, contracts]);

  if (isSvmBatch) {
    const matched =
      svmSnapshot != null &&
      svmRequestKey != null &&
      svmSnapshot.key === svmRequestKey;
    const keyedEntries: KeyedEntry[] = matched
      ? svmSnapshot.entries
      : (contracts as readonly KeyedSvmContract<K>[]).map(
          () =>
            ({
              status: "failure",
              error: new Error("svm_keyed_read_pending"),
            }) satisfies KeyedEntry,
        );
    const byKey = buildKeyMap(
      contracts as readonly KeyedContract<K>[],
      keyedEntries,
    );
    const pending = !matched;
    return resultApi(
      contracts as readonly KeyedContract<K>[],
      byKey,
      keyedEntries,
      { isPending: pending, isFetching: pending, isLoading: pending },
      refetchSvm,
    );
  }

  const results = data as readonly WagmiReadEntry[] | undefined;
  const keyedFromWagmi = (contracts as readonly KeyedContract<K>[]).map((_, i) =>
    toKeyedEntry(results?.[i]),
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
        toKeyedEntry(fresh?.[i]),
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

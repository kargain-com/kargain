"use client";

/**
 * Sole owner of wagmi `useReadContracts` and the SVM batch-read sibling (S8-3).
 * Consumers address results by named key — never by ordinal position.
 * Import ban: `test/keyed-multicall-policy.test.ts`.
 */

import { useMemo } from "react";
import type { Abi, Address } from "viem";
import { useReadContracts } from "wagmi";

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

/**
 * One multicall per batch. Conditional membership = omit named entries;
 * repeated groups = composite keys — never index or stride arithmetic.
 *
 * EVM batches use wagmi. SVM batches use {@link resolveSvmKeyedReads}
 * (fail-closed without an account source until S9).
 */
export function useKeyedReadContracts<const T extends readonly KeyedContract[]>(opts: {
  contracts: T;
  query?: {
    enabled?: boolean;
    staleTime?: number;
    gcTime?: number;
  };
  allowFailure?: boolean;
  /** Tests-only SVM account bytes; product omits → unresolved_namespace. */
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

  const svmResolved = useMemo(() => {
    if (!isSvmBatch) return null;
    const requests = (contracts as readonly KeyedSvmContract<K>[]).map((c) => ({
      key: c.key,
      account: c.account,
    }));
    return resolveSvmKeyedReads(requests, svmAccountSource);
  }, [contracts, isSvmBatch, svmAccountSource]);

  if (isSvmBatch && svmResolved) {
    const keyedEntries: KeyedEntry[] = svmResolved.entries.map((e) =>
      e.status === "success"
        ? { status: "success", result: e.result }
        : { status: "failure", error: e.error },
    );
    const byKey = buildKeyMap(
      contracts as readonly KeyedContract<K>[],
      keyedEntries,
    );
    return resultApi(
      contracts as readonly KeyedContract<K>[],
      byKey,
      keyedEntries,
      { isPending: false, isFetching: false, isLoading: false },
      async () => {
        const again = resolveSvmKeyedReads(
          (contracts as readonly KeyedSvmContract<K>[]).map((c) => ({
            key: c.key,
            account: c.account,
          })),
          svmAccountSource,
        );
        const fresh: KeyedEntry[] = again.entries.map((e) =>
          e.status === "success"
            ? { status: "success", result: e.result }
            : { status: "failure", error: e.error },
        );
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
      },
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

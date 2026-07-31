"use client";

/**
 * Sole owner of wagmi `useReadContracts`. Consumers address results by named
 * key — never by ordinal position. Import ban: `test/keyed-multicall-policy.test.ts`.
 */

import type { Abi, Address } from "viem";
import { useReadContracts } from "wagmi";

export type KeyedContract<K extends string = string> = {
  key: K;
  address: Address;
  abi: Abi;
  functionName: string;
  args?: readonly unknown[];
  chainId: number;
};

export type KeyedEntry =
  | { status: "success"; result: unknown }
  | { status: "failure"; error: Error };

type WagmiReadEntry =
  | { status: "success"; result: unknown }
  | { status: "failure"; error: Error };

function toKeyedEntry(raw: WagmiReadEntry | undefined): KeyedEntry | undefined {
  if (raw == null) return undefined;
  if (raw.status === "success") {
    return { status: "success", result: raw.result };
  }
  return { status: "failure", error: raw.error };
}

function buildKeyMap<K extends string>(
  contracts: readonly KeyedContract<K>[],
  data: readonly WagmiReadEntry[] | undefined,
): Map<K, KeyedEntry> {
  const map = new Map<K, KeyedEntry>();
  for (let i = 0; i < contracts.length; i++) {
    const entry = toKeyedEntry(data?.[i]);
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

/**
 * One multicall per batch. Conditional membership = omit named entries;
 * repeated groups = composite keys — never index or stride arithmetic.
 */
export function useKeyedReadContracts<const T extends readonly KeyedContract[]>(opts: {
  contracts: T;
  query?: {
    enabled?: boolean;
    staleTime?: number;
    gcTime?: number;
  };
  allowFailure?: boolean;
}): KeyedReadContractsResult<T[number]["key"]> {
  type K = T[number]["key"];
  const { contracts, query, allowFailure } = opts;

  const wagmiContracts = contracts.map(
    ({ address, abi, functionName, args, chainId }) => ({
      address,
      abi,
      functionName,
      args,
      chainId,
    }),
  );

  const { data, isPending, isFetching, isLoading, refetch } = useReadContracts({
    contracts: wagmiContracts,
    allowFailure,
    query,
  });

  const results = data as readonly WagmiReadEntry[] | undefined;
  const byKey = buildKeyMap(contracts as readonly KeyedContract<K>[], results);

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

  const entries: readonly (KeyedEntry | undefined)[] = contracts.map((_, i) =>
    toKeyedEntry(results?.[i]),
  );

  return {
    entry,
    get,
    asBigint,
    asNumber,
    asString,
    entries,
    isPending,
    isFetching,
    isLoading,
    refetch: async () => {
      const result = await refetch();
      const fresh = result.data as readonly WagmiReadEntry[] | undefined;
      const map = buildKeyMap(
        contracts as readonly KeyedContract<K>[],
        fresh,
      );
      return {
        get: (key: K): unknown | undefined => {
          const e = map.get(key);
          return e?.status === "success" ? e.result : undefined;
        },
        entry: (key: K): KeyedEntry | undefined => map.get(key),
      };
    },
  };
}

/**
 * SVM batch account-read sibling for keyed-multicall (S8-3 / U7 / S8-D1a).
 * Without a source, every entry is refused with `unresolved_namespace`.
 * Live bytes come from an injected {@link SvmKeyedAccountSource} (product:
 * `createProductSvmKeyedAccountSource` in svm-rpc). Async only — RPC is not sync.
 * One source call per resolve (unique accounts); never N sequential RPCs.
 * Causes are typed — never encoded in Error.message.
 */

import type { FetchSvmAccountDataCause } from "@/lib/web3/svm-rpc";

export type SvmKeyedReadRequest = {
  key: string;
  account: string;
};

/** Causes produced by the SVM keyed-read door (product + unresolved namespace). */
export type SvmKeyedReadCause =
  | FetchSvmAccountDataCause
  | "unresolved_namespace";

export type SvmKeyedReadEntry =
  | { status: "success"; result: Uint8Array }
  | { status: "refused"; cause: SvmKeyedReadCause; detail?: string };

/**
 * Injected account source (product RPC owner / tests). Async — no sync facade.
 * Batch door only: one `getAccountsData` per resolve for the unique set.
 * Aligns with {@link FetchSvmAccountsDataResult} so causes are never stringified.
 */
export type SvmKeyedAccountSource = {
  getAccountsData: (
    accounts: readonly string[],
  ) => Promise<SvmKeyedAccountSourceBatch>;
};

export type SvmKeyedAccountSourceBatch =
  | {
      ok: true;
      /** Per-account: bytes, or null when the RPC answered and the account is absent. */
      values: readonly (Uint8Array | null)[];
    }
  | {
      ok: false;
      cause: FetchSvmAccountDataCause;
      detail: string;
    };

/**
 * Resolve a batch of SVM account reads.
 * Without a source, every entry is refused with `unresolved_namespace`.
 * Unique accounts → one `getAccountsData`; results remapped to request order.
 */
export async function resolveSvmKeyedReads(
  requests: readonly SvmKeyedReadRequest[],
  source?: SvmKeyedAccountSource | null,
): Promise<{
  entries: SvmKeyedReadEntry[];
  cause: "unresolved_namespace" | null;
}> {
  if (requests.length === 0) {
    return {
      entries: [],
      cause: source == null ? "unresolved_namespace" : null,
    };
  }

  if (source == null) {
    return {
      entries: requests.map(() => ({
        status: "refused" as const,
        cause: "unresolved_namespace" as const,
      })),
      cause: "unresolved_namespace",
    };
  }

  const unique: string[] = [];
  const firstIndex = new Map<string, number>();
  for (const req of requests) {
    if (!firstIndex.has(req.account)) {
      firstIndex.set(req.account, unique.length);
      unique.push(req.account);
    }
  }

  let batch: SvmKeyedAccountSourceBatch;
  try {
    batch = await source.getAccountsData(unique);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return {
      entries: requests.map(() => ({
        status: "refused" as const,
        cause: "rpc_unavailable" as const,
        detail,
      })),
      cause: null,
    };
  }

  if (!batch.ok) {
    return {
      entries: requests.map(() => ({
        status: "refused" as const,
        cause: batch.cause,
        detail: batch.detail,
      })),
      cause: null,
    };
  }

  if (!Array.isArray(batch.values) || batch.values.length !== unique.length) {
    return {
      entries: requests.map(() => ({
        status: "refused" as const,
        cause: "malformed_response" as const,
        detail: "getAccountsData length mismatch",
      })),
      cause: null,
    };
  }

  const entries: SvmKeyedReadEntry[] = requests.map((req) => {
    const idx = firstIndex.get(req.account);
    if (idx == null) {
      return {
        status: "refused" as const,
        cause: "account_not_found" as const,
        detail: req.account,
      };
    }
    const data = batch.values[idx];
    if (data == null) {
      return {
        status: "refused" as const,
        cause: "account_not_found" as const,
        detail: req.account,
      };
    }
    return { status: "success", result: data };
  });

  return { entries, cause: null };
}

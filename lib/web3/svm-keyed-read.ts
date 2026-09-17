/**
 * SVM batch account-read sibling for keyed-multicall (S8-3 / U7).
 * Without a source, every entry fails with `unresolved_namespace`.
 * Live bytes come from an injected {@link SvmKeyedAccountSource} (product:
 * `createProductSvmKeyedAccountSource` in svm-rpc). Async only — RPC is not sync.
 * One source call per resolve (unique accounts); never N sequential RPCs.
 */

export type SvmKeyedReadRequest = {
  key: string;
  account: string;
};

export type SvmKeyedReadEntry =
  | { status: "success"; result: Uint8Array }
  | { status: "failure"; error: Error };

/**
 * Injected account source (product RPC owner / tests). Async — no sync facade.
 * Batch door only: one `getAccountsData` per resolve for the unique set.
 */
export type SvmKeyedAccountSource = {
  getAccountsData: (
    accounts: readonly string[],
  ) => Promise<(Uint8Array | null | undefined)[]>;
};

/**
 * Resolve a batch of SVM account reads.
 * Without a source, every entry fails with `unresolved_namespace`.
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
    const err = new Error("unresolved_namespace");
    return {
      entries: requests.map(() => ({ status: "failure", error: err })),
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

  let batch: (Uint8Array | null | undefined)[];
  try {
    batch = await source.getAccountsData(unique);
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    return {
      entries: requests.map(() => ({ status: "failure", error })),
      cause: null,
    };
  }

  if (!Array.isArray(batch) || batch.length !== unique.length) {
    const error = new Error("malformed_response: getAccountsData length mismatch");
    return {
      entries: requests.map(() => ({ status: "failure", error })),
      cause: null,
    };
  }

  const entries: SvmKeyedReadEntry[] = requests.map((req) => {
    const idx = firstIndex.get(req.account);
    if (idx == null) {
      return {
        status: "failure",
        error: new Error(`account_not_found: ${req.account}`),
      };
    }
    const data = batch[idx];
    if (data == null) {
      return {
        status: "failure",
        error: new Error(`account_not_found: ${req.account}`),
      };
    }
    return { status: "success", result: data };
  });

  return { entries, cause: null };
}

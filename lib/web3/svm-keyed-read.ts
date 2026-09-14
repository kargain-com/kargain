/**
 * SVM batch account-read sibling for keyed-multicall (S8-3 / U7).
 * Without a source, every entry fails with `unresolved_namespace`.
 * Live bytes come from an injected {@link SvmKeyedAccountSource} (product:
 * `createProductSvmKeyedAccountSource` in svm-rpc). Async only — RPC is not sync.
 */

export type SvmKeyedReadRequest = {
  key: string;
  account: string;
};

export type SvmKeyedReadEntry =
  | { status: "success"; result: Uint8Array }
  | { status: "failure"; error: Error };

/** Injected account source (product RPC owner / tests). Async — no sync facade. */
export type SvmKeyedAccountSource = {
  getAccountData: (
    account: string,
  ) => Promise<Uint8Array | null | undefined>;
};

/**
 * Resolve a batch of SVM account reads.
 * Without a source, every entry fails with `unresolved_namespace`.
 */
export async function resolveSvmKeyedReads(
  requests: readonly SvmKeyedReadRequest[],
  source?: SvmKeyedAccountSource | null,
): Promise<{
  entries: SvmKeyedReadEntry[];
  cause: "unresolved_namespace" | null;
}> {
  if (source == null) {
    const err = new Error("unresolved_namespace");
    return {
      entries: requests.map(() => ({ status: "failure", error: err })),
      cause: "unresolved_namespace",
    };
  }

  const entries: SvmKeyedReadEntry[] = [];
  for (const req of requests) {
    try {
      const data = await source.getAccountData(req.account);
      if (data == null) {
        entries.push({
          status: "failure",
          error: new Error(`account_not_found: ${req.account}`),
        });
        continue;
      }
      entries.push({ status: "success", result: data });
    } catch (err) {
      entries.push({
        status: "failure",
        error: err instanceof Error ? err : new Error(String(err)),
      });
    }
  }
  return { entries, cause: null };
}

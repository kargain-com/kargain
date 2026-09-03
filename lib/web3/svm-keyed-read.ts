/**
 * SVM batch account-read sibling for keyed-multicall (S8-3).
 * Product has no commercial SVM reader until S9 — unresolved batches fail closed
 * by name. Tests inject account bytes via {@link SvmKeyedAccountSource}.
 */

export type SvmKeyedReadRequest = {
  key: string;
  account: string;
};

export type SvmKeyedReadEntry =
  | { status: "success"; result: Uint8Array }
  | { status: "failure"; error: Error };

/** Optional injected account source (tests / future RPC owner). */
export type SvmKeyedAccountSource = {
  getAccountData: (account: string) => Uint8Array | null | undefined;
};

/**
 * Resolve a batch of SVM account reads.
 * Without a source (product default), every entry fails with `unresolved_namespace`.
 */
export function resolveSvmKeyedReads(
  requests: readonly SvmKeyedReadRequest[],
  source?: SvmKeyedAccountSource | null,
): {
  entries: SvmKeyedReadEntry[];
  cause: "unresolved_namespace" | null;
} {
  if (source == null) {
    const err = new Error("unresolved_namespace");
    return {
      entries: requests.map(() => ({ status: "failure", error: err })),
      cause: "unresolved_namespace",
    };
  }

  const entries: SvmKeyedReadEntry[] = requests.map((req) => {
    const data = source.getAccountData(req.account);
    if (data == null) {
      return {
        status: "failure",
        error: new Error(`svm account unread: ${req.account}`),
      };
    }
    return { status: "success", result: data };
  });
  return { entries, cause: null };
}

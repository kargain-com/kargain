/**
 * Sole getBlock wire → ingest transaction rows.
 * Accepts legacy / version 0 / version 1; never decodes the message body.
 * Ingest only needs signature + meta.err + meta.logMessages.
 */

export type RpcBlockTransactionRow = {
  signature: string;
  metaErr: unknown;
  logMessages: string[] | null;
};

/** Wire shape after JSON-RPC getBlock (encoding json, transactionDetails full). */
export type GetBlockWireResult = {
  transactions?: readonly GetBlockWireTransaction[] | null;
} | null;

export type GetBlockWireTransaction = {
  version?: "legacy" | 0 | 1;
  transaction?: {
    signatures?: readonly string[] | null;
  } | null;
  meta?: {
    err?: unknown;
    logMessages?: readonly string[] | null;
  } | null;
};

/**
 * Map a getBlock JSON-RPC result to ingest rows.
 * Ignores `version` except that values 0, 1, "legacy", and absent are legal.
 */
export function mapGetBlockResultToFetchedTransactions(
  result: GetBlockWireResult,
  slot: number,
): RpcBlockTransactionRow[] {
  if (result == null) {
    return [];
  }
  const txs = result.transactions;
  if (!Array.isArray(txs)) {
    return [];
  }
  const out: RpcBlockTransactionRow[] = [];
  for (let i = 0; i < txs.length; i++) {
    const tx = txs[i]!;
    const version = tx.version;
    if (
      version !== undefined &&
      version !== "legacy" &&
      version !== 0 &&
      version !== 1
    ) {
      throw new Error(
        `block ${slot} tx ${i}: unsupported transaction version ${String(version)}`,
      );
    }
    const signature = tx.transaction?.signatures?.[0];
    if (typeof signature !== "string" || signature.length === 0) {
      throw new Error(`block ${slot} tx ${i} missing signature`);
    }
    const logMessages = tx.meta?.logMessages;
    out.push({
      signature,
      metaErr: tx.meta?.err ?? null,
      logMessages: Array.isArray(logMessages) ? [...logMessages] : null,
    });
  }
  return out;
}

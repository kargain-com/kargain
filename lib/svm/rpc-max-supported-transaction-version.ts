/**
 * Sole ceiling for Solana JSON-RPC getBlock / getTransaction /
 * maxSupportedTransactionVersion. Integer 1 opts into transaction version 1;
 * ceiling 0 fails an entire getBlock when any v1 tx is present (−32015).
 *
 * Ingest only reads meta.logMessages — this opt-in is not a second decoder.
 */
export const RPC_MAX_SUPPORTED_TRANSACTION_VERSION = 1 as const;

export type RpcMaxSupportedTransactionVersion =
  typeof RPC_MAX_SUPPORTED_TRANSACTION_VERSION;

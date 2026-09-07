/**
 * Sole ceiling for Solana JSON-RPC getBlock / getTransaction /
 * maxSupportedTransactionVersion. Integer 1 opts into transaction version 1;
 * ceiling 0 fails an entire getBlock when any v1 tx is present (−32015).
 *
 * Ingest getBlock uses JSON-RPC + lib/svm/rpc-block-transactions (not
 * Connection.getBlock — web3.js schemas reject version 1 after the RPC opt-in).
 */
export const RPC_MAX_SUPPORTED_TRANSACTION_VERSION = 1 as const;

export type RpcMaxSupportedTransactionVersion =
  typeof RPC_MAX_SUPPORTED_TRANSACTION_VERSION;

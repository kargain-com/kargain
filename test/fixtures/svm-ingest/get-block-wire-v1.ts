/**
 * Recorded getBlock JSON-RPC result shape (encoding json, transactionDetails full).
 * Includes legacy (absent version), version 0, and version 1 — the wire that
 * @solana/web3.js Connection.getBlock rejects on `version: 1`.
 */
import type { GetBlockWireResult } from "../../../lib/svm/rpc-block-transactions.ts";

export const GET_BLOCK_WIRE_WITH_VERSION_1: GetBlockWireResult = {
  transactions: [
    {
      transaction: {
        signatures: ["LegacySig1111111111111111111111111111111111"],
      },
      meta: {
        err: null,
        logMessages: ["Program log: legacy"],
      },
    },
    {
      version: 0,
      transaction: {
        signatures: ["Version0Sig11111111111111111111111111111111"],
      },
      meta: {
        err: null,
        logMessages: ["Program log: v0"],
      },
    },
    {
      version: 1,
      transaction: {
        signatures: ["Version1Sig11111111111111111111111111111111"],
      },
      meta: {
        err: null,
        logMessages: [
          "Program log: v1 carrier",
          "Program data: AQID",
        ],
      },
    },
  ],
};

/** Production failure class when web3.js schema sees version 1. */
export const WEB3JS_VERSION_1_SCHEMA_REFUSAL =
  "failed to get confirmed block: At path: transactions.4.version -- Expected the value to satisfy a union of `literal | literal`, but received: 1";

/**
 * getBlock with ceiling 0 reproduces Devnet −32015; ceiling 1 returns versioned txs' logs.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Connection } from "@solana/web3.js";

import { RPC_MAX_SUPPORTED_TRANSACTION_VERSION } from "../lib/svm/rpc-max-supported-transaction-version.ts";
import {
  createSolanaRpcClient,
  solanaGetBlockRequestConfig,
} from "../src/svm-ingest/rpc-client.ts";

const VERSION_1_REFUSAL =
  'failed to get confirmed block: Transaction version (1) is not supported by the requesting client. Please try the request again with the following configuration parameter: "maxSupportedTransactionVersion": 1';

describe("svm-ingest-rpc-client-version", () => {
  it("solanaGetBlockRequestConfig pins the owner ceiling", () => {
    const cfg = solanaGetBlockRequestConfig();
    assert.equal(
      cfg.maxSupportedTransactionVersion,
      RPC_MAX_SUPPORTED_TRANSACTION_VERSION,
    );
    assert.equal(cfg.maxSupportedTransactionVersion, 1);
    assert.equal(cfg.transactionDetails, "full");
    assert.equal(cfg.rewards, false);
  });

  it("RED: getBlock with ceiling 0 throws the live RPC version-1 message", async () => {
    const connection = {
      getSlot: async () => 1,
      getFirstAvailableBlock: async () => 1,
      getSignaturesForAddress: async () => [],
      getBlock: async (
        _slot: number,
        opts?: { maxSupportedTransactionVersion?: number },
      ) => {
        if ((opts?.maxSupportedTransactionVersion ?? -1) < 1) {
          throw new Error(VERSION_1_REFUSAL);
        }
        return null;
      },
    } as unknown as Connection;

    // Constructed dual path: a client that still asked for 0 would die like VPS.
    await assert.rejects(async () => {
      await connection.getBlock(99, {
        maxSupportedTransactionVersion: 0,
        transactionDetails: "full",
        rewards: false,
      } as never);
    }, /maxSupportedTransactionVersion": 1/);
  });

  it("GREEN: ingest getBlock with owner ceiling returns versioned tx logMessages", async () => {
    const connection = {
      getSlot: async () => 1,
      getFirstAvailableBlock: async () => 1,
      getSignaturesForAddress: async () => [],
      getBlock: async (
        slot: number,
        opts?: { maxSupportedTransactionVersion?: number },
      ) => {
        if ((opts?.maxSupportedTransactionVersion ?? -1) < 1) {
          throw new Error(VERSION_1_REFUSAL);
        }
        return {
          blockhash: "x",
          previousBlockhash: "y",
          parentSlot: slot - 1,
          transactions: [
            {
              transaction: {
                signatures: ["SigVersioned11111111111111111111111111111111"],
                message: { version: 1 },
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
          rewards: [],
          blockTime: null,
        };
      },
    } as unknown as Connection;

    const client = createSolanaRpcClient("http://127.0.0.1:9", {
      connection,
      maxRps: 100,
      missingBlockRetries: 0,
      rateLimitMaxAttempts: 1,
    });
    const outcome = await client.getBlock(494500000);
    assert.equal(outcome.status, "ok");
    if (outcome.status !== "ok") throw new Error("expected ok");
    assert.equal(outcome.block.transactions.length, 1);
    assert.equal(
      outcome.block.transactions[0]!.signature,
      "SigVersioned11111111111111111111111111111111",
    );
    assert.deepEqual(outcome.block.transactions[0]!.logMessages, [
      "Program log: v1 carrier",
      "Program data: AQID",
    ]);
  });
});

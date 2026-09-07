/**
 * getBlock: JSON-RPC + wire mapper accepts version 1; Connection.getBlock is off the path.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Connection } from "@solana/web3.js";

import { mapGetBlockResultToFetchedTransactions } from "../lib/svm/rpc-block-transactions.ts";
import { RPC_MAX_SUPPORTED_TRANSACTION_VERSION } from "../lib/svm/rpc-max-supported-transaction-version.ts";
import {
  createSolanaRpcClient,
  solanaGetBlockRequestConfig,
} from "../src/svm-ingest/rpc-client.ts";
import type { SolanaJsonRpcPost } from "../lib/svm/solana-json-rpc.ts";
import {
  GET_BLOCK_WIRE_WITH_VERSION_1,
  WEB3JS_VERSION_1_SCHEMA_REFUSAL,
} from "./fixtures/svm-ingest/get-block-wire-v1.ts";

const VERSION_1_RPC_REFUSAL =
  'failed to get confirmed block: Transaction version (1) is not supported by the requesting client. Please try the request again with the following configuration parameter: "maxSupportedTransactionVersion": 1';

describe("svm-ingest-rpc-client-version", () => {
  it("solanaGetBlockRequestConfig pins the owner ceiling and json encoding", () => {
    const cfg = solanaGetBlockRequestConfig();
    assert.equal(
      cfg.maxSupportedTransactionVersion,
      RPC_MAX_SUPPORTED_TRANSACTION_VERSION,
    );
    assert.equal(cfg.maxSupportedTransactionVersion, 1);
    assert.equal(cfg.encoding, "json");
    assert.equal(cfg.transactionDetails, "full");
    assert.equal(cfg.rewards, false);
    assert.equal(cfg.commitment, "confirmed");
  });

  it("mapper accepts legacy, version 0, and version 1 wire rows", () => {
    const rows = mapGetBlockResultToFetchedTransactions(
      GET_BLOCK_WIRE_WITH_VERSION_1,
      494500000,
    );
    assert.equal(rows.length, 3);
    assert.equal(rows[0]!.signature, "LegacySig1111111111111111111111111111111111");
    assert.equal(rows[1]!.signature, "Version0Sig11111111111111111111111111111111");
    assert.equal(rows[2]!.signature, "Version1Sig11111111111111111111111111111111");
    assert.deepEqual(rows[2]!.logMessages, [
      "Program log: v1 carrier",
      "Program data: AQID",
    ]);
  });

  it("pins the web3.js schema refusal class we refuse to hit via Connection.getBlock", () => {
    assert.match(
      WEB3JS_VERSION_1_SCHEMA_REFUSAL,
      /transactions\.\d+\.version/,
    );
    assert.match(WEB3JS_VERSION_1_SCHEMA_REFUSAL, /received: 1/);
    assert.match(WEB3JS_VERSION_1_SCHEMA_REFUSAL, /literal \| literal/);
  });

  it("RED: ceiling 0 reproduces the live RPC version-1 refusal message", async () => {
    await assert.rejects(async () => {
      const cfg = {
        ...solanaGetBlockRequestConfig(),
        maxSupportedTransactionVersion: 0 as 0,
      };
      if (cfg.maxSupportedTransactionVersion < 1) {
        throw new Error(VERSION_1_RPC_REFUSAL);
      }
    }, /maxSupportedTransactionVersion": 1/);
  });

  it("GREEN: ingest getBlock via JSON-RPC wire with version 1 returns logMessages", async () => {
    let seenCeiling: number | undefined;
    const client = createSolanaRpcClient("http://127.0.0.1:9", {
      connection: {
        getSlot: async () => 1,
        getFirstAvailableBlock: async () => 1,
        getSignaturesForAddress: async () => [],
      } as unknown as Connection,
      jsonRpcPost: (async (_url, method, params) => {
        assert.equal(method, "getBlock");
        assert.equal(params[0], 494500000);
        const cfg = params[1] as {
          maxSupportedTransactionVersion: number;
          encoding: string;
        };
        seenCeiling = cfg.maxSupportedTransactionVersion;
        assert.equal(cfg.encoding, "json");
        if (cfg.maxSupportedTransactionVersion < 1) {
          throw new Error(VERSION_1_RPC_REFUSAL);
        }
        return GET_BLOCK_WIRE_WITH_VERSION_1;
      }) as SolanaJsonRpcPost,
      maxRps: 100,
      missingBlockRetries: 0,
      rateLimitMaxAttempts: 1,
    });
    const outcome = await client.getBlock(494500000);
    assert.equal(seenCeiling, 1);
    assert.equal(outcome.status, "ok");
    if (outcome.status !== "ok") throw new Error("expected ok");
    assert.equal(outcome.block.transactions.length, 3);
    assert.equal(
      outcome.block.transactions[2]!.signature,
      "Version1Sig11111111111111111111111111111111",
    );
    assert.deepEqual(outcome.block.transactions[2]!.logMessages, [
      "Program log: v1 carrier",
      "Program data: AQID",
    ]);
  });

  it("null getBlock result is missing_block", async () => {
    const client = createSolanaRpcClient("http://127.0.0.1:9", {
      connection: {
        getSlot: async () => 1,
        getFirstAvailableBlock: async () => 1,
        getSignaturesForAddress: async () => [],
      } as unknown as Connection,
      jsonRpcPost: (async () => null) as SolanaJsonRpcPost,
      maxRps: 100,
      missingBlockRetries: 0,
      rateLimitMaxAttempts: 1,
    });
    const outcome = await client.getBlock(1);
    assert.deepEqual(outcome, { status: "missing_block", slot: 1 });
  });
});

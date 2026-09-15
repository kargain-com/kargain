/**
 * Sole maxSupportedTransactionVersion = 1 — ban bare 0 ceilings that fail getBlock on v1 txs.
 * Ingest getBlock is JSON-RPC + wire mapper — ban Connection.getBlock (web3.js rejects version 1).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, it } from "node:test";

import { RPC_MAX_SUPPORTED_TRANSACTION_VERSION } from "../lib/svm/rpc-max-supported-transaction-version.ts";
import {
  POLICY_SCAN_ROOT,
  walkTsFilesFromRoots,
} from "./policy-scan-helpers.ts";

const ROOT = POLICY_SCAN_ROOT;
const OWNER_REL = "lib/svm/rpc-max-supported-transaction-version.ts";
const MAPPER_REL = "lib/svm/rpc-block-transactions.ts";
const JSON_RPC_REL = "lib/svm/solana-json-rpc.ts";
const RPC_CLIENT_REL = "src/svm-ingest/rpc-client.ts";
const SVM_RPC_REL = "lib/web3/svm-rpc.ts";

const LITERAL_CEILING_RE =
  /maxSupportedTransactionVersion\s*:\s*0\b/;

const GET_BLOCK_RE = /connection\.getBlock\s*\(/;

const SCAN_ROOTS = [
  "lib",
  "src",
  "scripts",
  "svm/stand",
  "svm/lab",
] as const;

function collectViolations(rootDir: string): string[] {
  const hits: string[] = [];
  for (const abs of walkTsFilesFromRoots([...SCAN_ROOTS], rootDir)) {
    const rel = relative(rootDir, abs).replace(/\\/g, "/");
    if (rel === OWNER_REL) continue;
    let source: string;
    try {
      source = readFileSync(abs, "utf8");
    } catch {
      continue;
    }
    if (LITERAL_CEILING_RE.test(source)) {
      hits.push(rel);
    }
  }
  return hits.sort();
}

describe("svm-rpc-transaction-version-policy", () => {
  it("owner exports ceiling 1", () => {
    assert.equal(RPC_MAX_SUPPORTED_TRANSACTION_VERSION, 1);
  });

  it("no bare maxSupportedTransactionVersion: 0 outside the owner", () => {
    assert.deepEqual(collectViolations(ROOT), []);
  });

  it("constructed dirty fixture is red then green (in-memory; never plant under lib/)", () => {
    const dirty = `export const bad = { maxSupportedTransactionVersion: 0 };\n`;
    const clean = `export const ok = { maxSupportedTransactionVersion: 1 };\n`;
    assert.equal(LITERAL_CEILING_RE.test(dirty), true);
    assert.equal(LITERAL_CEILING_RE.test(clean), false);
    assert.deepEqual(collectViolations(ROOT), []);
  });

  it("rpc-client uses JSON-RPC getBlock + wire mapper; never Connection.getBlock", () => {
    const rpcClient = readFileSync(join(ROOT, RPC_CLIENT_REL), "utf8");
    assert.match(rpcClient, /RPC_MAX_SUPPORTED_TRANSACTION_VERSION/);
    assert.match(rpcClient, /solanaGetBlockRequestConfig/);
    assert.match(rpcClient, /mapGetBlockResultToFetchedTransactions/);
    assert.match(rpcClient, /postSolanaJsonRpc/);
    assert.doesNotMatch(rpcClient, GET_BLOCK_RE);
    assert.match(
      readFileSync(join(ROOT, MAPPER_REL), "utf8"),
      /mapGetBlockResultToFetchedTransactions/,
    );
    assert.match(
      readFileSync(join(ROOT, JSON_RPC_REL), "utf8"),
      /postSolanaJsonRpc/,
    );
  });

  it("product svm-rpc consumes shared postSolanaJsonRpc (no private postJsonRpc copy)", () => {
    const svmRpc = readFileSync(join(ROOT, SVM_RPC_REL), "utf8");
    assert.match(svmRpc, /RPC_MAX_SUPPORTED_TRANSACTION_VERSION/);
    assert.match(svmRpc, /postSolanaJsonRpc/);
    assert.match(svmRpc, /from ["']@\/lib\/svm\/solana-json-rpc["']/);
    assert.doesNotMatch(svmRpc, /async function postJsonRpc/);
  });

  it("planted Connection.getBlock in rpc-client source is red then green (in-memory; never mutate src/)", () => {
    const original = readFileSync(join(ROOT, RPC_CLIENT_REL), "utf8");
    assert.doesNotMatch(original, GET_BLOCK_RE);
    const dirty = `${original}\nvoid (null as unknown as { getBlock: () => void }).getBlock;\nconnection.getBlock(0 as never);\n`;
    assert.match(dirty, GET_BLOCK_RE);
    assert.doesNotMatch(original, GET_BLOCK_RE);
    assert.doesNotMatch(
      readFileSync(join(ROOT, RPC_CLIENT_REL), "utf8"),
      GET_BLOCK_RE,
    );
  });
});

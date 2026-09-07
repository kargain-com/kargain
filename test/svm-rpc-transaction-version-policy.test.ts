/**
 * Sole maxSupportedTransactionVersion = 1 — ban bare 0 ceilings that fail getBlock on v1 txs.
 */
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { RPC_MAX_SUPPORTED_TRANSACTION_VERSION } from "../lib/svm/rpc-max-supported-transaction-version.ts";
import {
  POLICY_SCAN_ROOT,
  walkTsFilesFromRoots,
} from "./policy-scan-helpers.ts";

const ROOT = POLICY_SCAN_ROOT;
const OWNER_REL = "lib/svm/rpc-max-supported-transaction-version.ts";

const LITERAL_CEILING_RE =
  /maxSupportedTransactionVersion\s*:\s*0\b/;

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
    const source = readFileSync(abs, "utf8");
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

  it("constructed dirty fixture under lib/ is red then green", () => {
    const dirtyDir = join(ROOT, "lib", ".tmp-rpc-version-policy");
    const dirtyFile = join(dirtyDir, "planted-ceiling-zero.ts");
    mkdirSync(dirtyDir, { recursive: true });
    try {
      writeFileSync(
        dirtyFile,
        `export const bad = { maxSupportedTransactionVersion: 0 };\n`,
        "utf8",
      );
      const red = collectViolations(ROOT);
      assert.ok(
        red.some((p) => p.includes("planted-ceiling-zero.ts")),
        `expected planted hit, got ${JSON.stringify(red)}`,
      );
    } finally {
      rmSync(dirtyDir, { recursive: true, force: true });
    }
    assert.deepEqual(collectViolations(ROOT), []);
  });

  it("rpc-client and svm-rpc consume the owner symbol", () => {
    const rpcClient = readFileSync(
      join(ROOT, "src/svm-ingest/rpc-client.ts"),
      "utf8",
    );
    assert.match(rpcClient, /RPC_MAX_SUPPORTED_TRANSACTION_VERSION/);
    assert.match(rpcClient, /solanaGetBlockRequestConfig/);
    const svmRpc = readFileSync(join(ROOT, "lib/web3/svm-rpc.ts"), "utf8");
    assert.match(svmRpc, /RPC_MAX_SUPPORTED_TRANSACTION_VERSION/);
  });
});

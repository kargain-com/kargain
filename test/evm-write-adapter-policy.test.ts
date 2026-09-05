/**
 * S8-3 — wagmi write/send hooks only in evm-write-adapter;
 * receipt / SVM confirm only reachable from lifecycle / confirm owners.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  POLICY_SCAN_ROOT,
  scanProductSources,
} from "./policy-scan-helpers.ts";

const WRITE_ADAPTER = "lib/web3/evm-write-adapter.ts";
const TX_SYNC = "hooks/use-tx-sync.ts";
const EVM_CONFIRM = "lib/web3/evm-tx-confirm.ts";
const EVM_LIFECYCLE = "lib/web3/evm-write-lifecycle.ts";
const SVM_CONFIRM = "lib/web3/svm-tx-confirm.ts";

const WRITE_HOOK_FROM_WAGMI =
  /import\s*(?:type\s+)?\{[^}]*\b(?:useWriteContract|useSendTransaction)\b[^}]*\}\s*from\s*["']wagmi["']/;

const RECEIPT_WAIT = /\bwaitForTransactionReceipt\b/;
const SVM_CONFIRM_CALL = /\bconfirmSvmTransaction\b/;

function writeHookPredicate(rel: string, source: string): string | false {
  if (!WRITE_HOOK_FROM_WAGMI.test(source)) return false;
  return `wagmi write/send hook outside EVM write adapter (${rel})`;
}

function receiptWaitPredicate(rel: string, source: string): string | false {
  if (!RECEIPT_WAIT.test(source)) return false;
  return `waitForTransactionReceipt outside evm-tx-confirm (${rel})`;
}

function svmConfirmPredicate(rel: string, source: string): string | false {
  if (!SVM_CONFIRM_CALL.test(source)) return false;
  return `confirmSvmTransaction outside svm-tx-confirm (${rel})`;
}

describe("evm write adapter policy", () => {
  it("allows useWriteContract / useSendTransaction import only in the write adapter", () => {
    const violations = scanProductSources(writeHookPredicate, {
      owners: [WRITE_ADAPTER],
    });
    assert.deepEqual(
      violations,
      [],
      violations.map((v) => `${v.path}: ${v.reason}`).join("\n"),
    );
  });

  it("owning adapter imports both write hooks from wagmi", () => {
    const source = readFileSync(`${POLICY_SCAN_ROOT}/${WRITE_ADAPTER}`, "utf8");
    assert.match(source, /\buseWriteContract\b/);
    assert.match(source, /\buseSendTransaction\b/);
    assert.match(source, /from\s*["']wagmi["']/);
  });

  it("catches a planted write hook outside the adapter (red→green)", () => {
    const dirty = `import { useWriteContract } from "wagmi";\n`;
    assert.equal(
      writeHookPredicate("components/planted.tsx", dirty),
      "wagmi write/send hook outside EVM write adapter (components/planted.tsx)",
    );
    const clean = `import { useEvmWriteContract } from "@/lib/web3/evm-write-adapter";\n`;
    assert.equal(writeHookPredicate("components/planted.tsx", clean), false);
  });
});

describe("tx confirm ownership policy", () => {
  it("allows waitForTransactionReceipt only in evm-tx-confirm", () => {
    const violations = scanProductSources(receiptWaitPredicate, {
      owners: [EVM_CONFIRM],
    });
    assert.deepEqual(
      violations,
      [],
      violations.map((v) => `${v.path}: ${v.reason}`).join("\n"),
    );
  });

  it("lifecycle owner consumes confirmEvmTransaction while use-tx-sync stays receipt-blind", () => {
    const source = readFileSync(`${POLICY_SCAN_ROOT}/${EVM_LIFECYCLE}`, "utf8");
    assert.match(source, /confirmEvmTransaction/);
    assert.ok(!RECEIPT_WAIT.test(source));
    const hook = readFileSync(`${POLICY_SCAN_ROOT}/${TX_SYNC}`, "utf8");
    assert.doesNotMatch(hook, /\bconfirmEvmTransaction\b/);
    assert.match(hook, /\brunEvmWriteLifecycle\b/);
  });

  it("confirmSvmTransaction is not called from product outside its owner", () => {
    const violations = scanProductSources(svmConfirmPredicate, {
      owners: [SVM_CONFIRM],
    });
    assert.deepEqual(
      violations,
      [],
      violations.map((v) => `${v.path}: ${v.reason}`).join("\n"),
    );
  });

  it("catches a planted receipt wait outside the confirm owner (red→green)", () => {
    const dirty = `import { waitForTransactionReceipt } from "wagmi/actions";\n`;
    assert.equal(
      receiptWaitPredicate("hooks/planted.ts", dirty),
      "waitForTransactionReceipt outside evm-tx-confirm (hooks/planted.ts)",
    );
    const clean = `import { confirmEvmTransaction } from "@/lib/web3/evm-tx-confirm";\n`;
    assert.equal(receiptWaitPredicate("hooks/planted.ts", clean), false);
  });
});

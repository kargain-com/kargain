/**
 * Unit T — EVM confirm owner: timeout on every wait; Outcome classification;
 * deposit maps only WaitForTransactionReceiptTimeoutError → timeout.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { WaitForTransactionReceiptTimeoutError } from "viem";

import {
  assertCleanProductScan,
  scanProductSources,
} from "./policy-scan-helpers.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EVM_CONFIRM = path.join(ROOT, "lib/web3/evm-tx-confirm.ts");

const WAIT_WITHOUT_TIMEOUT =
  /waitForTransactionReceipt\s*\(\s*[^,]+,\s*\{(?![^}]*\btimeout\b)[^}]*\}\s*\)/;

function waitWithoutTimeoutPredicate(
  rel: string,
  source: string,
): string | false {
  if (!WAIT_WITHOUT_TIMEOUT.test(source)) return false;
  return `waitForTransactionReceipt without timeout (${rel})`;
}

describe("evm-tx-confirm policy — Unit T", () => {
  it("EVM_TX_CONFIRM_TIMEOUT_MS reaches both waits", () => {
    const source = readFileSync(EVM_CONFIRM, "utf8");
    assert.match(source, /export const EVM_TX_CONFIRM_TIMEOUT_MS = 180_000/);
    assert.match(source, /viem's own default/);
    const confirmFn = source.slice(
      source.indexOf("export async function confirmEvmTransaction"),
      source.indexOf("export type EvmDepositConfirmOutcome"),
    );
    assert.match(confirmFn, /timeout:\s*EVM_TX_CONFIRM_TIMEOUT_MS/);
    const depositFn = source.slice(
      source.indexOf("export async function confirmEvmTransactionConfirmations"),
    );
    assert.match(depositFn, /timeout:\s*EVM_TX_CONFIRM_TIMEOUT_MS/);
  });

  it("confirmEvmTransaction returns EvmConfirmOutcome (not bare receipt)", () => {
    const source = readFileSync(EVM_CONFIRM, "utf8");
    assert.match(
      source,
      /export async function confirmEvmTransaction\([\s\S]*?\): Promise<EvmConfirmOutcome>/,
    );
    assert.match(source, /kind: "landed_ok"/);
    assert.match(source, /kind: "reverted"/);
    assert.match(source, /kind: "superseded"/);
    assert.match(source, /kind: "status_unknown"/);
    assert.match(source, /WaitForTransactionReceiptTimeoutError/);
    assert.match(source, /from "viem\/actions"/);
    assert.equal(/from "wagmi\/actions"/.test(source), false);
  });

  it("deposit confirm maps only timeout class to timeout (not catch-all)", () => {
    const source = readFileSync(EVM_CONFIRM, "utf8");
    const depositFn = source.slice(
      source.indexOf("export async function confirmEvmTransactionConfirmations"),
    );
    assert.match(
      depositFn,
      /err instanceof WaitForTransactionReceiptTimeoutError/,
    );
    assert.equal(/catch\s*\{\s*return \{ kind: "timeout" \}/.test(depositFn), false);
    // Plant: catch-all would be red
    const plant = `} catch {\n    return { kind: "timeout" };\n  }`;
    assert.match(plant, /catch\s*\{/);
    assert.match(plant, /kind: "timeout"/);
  });

  it("product scan: waitForTransactionReceipt without timeout is banned outside owner", () => {
    const scan = scanProductSources(waitWithoutTimeoutPredicate, {
      owners: ["lib/web3/evm-tx-confirm.ts"],
    });
    assertCleanProductScan(scan, { owners: ["lib/web3/evm-tx-confirm.ts"] });
  });

  it("in-memory plant: wait without timeout is red", () => {
    const dirty = `await waitForTransactionReceipt(client, { hash });\n`;
    assert.equal(
      waitWithoutTimeoutPredicate("lib/web3/planted.ts", dirty),
      "waitForTransactionReceipt without timeout (lib/web3/planted.ts)",
    );
    const clean = `await waitForTransactionReceipt(client, { hash, timeout: EVM_TX_CONFIRM_TIMEOUT_MS });\n`;
    assert.equal(waitWithoutTimeoutPredicate("lib/web3/evm-tx-confirm.ts", clean), false);
  });

  it("WaitForTransactionReceiptTimeoutError is the timeout class (instanceof plant)", () => {
    const err = new WaitForTransactionReceiptTimeoutError({
      hash: `0x${"0".repeat(64)}`,
    });
    assert.ok(err instanceof WaitForTransactionReceiptTimeoutError);
    assert.equal(err.name, "WaitForTransactionReceiptTimeoutError");
  });
});

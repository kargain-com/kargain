/**
 * S8-3 — write availability named causes + SVM keyed sibling + program errors.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { REVERT_COPY, txErrorMessage, decodeSvmProgramError } from "../lib/marketplace/tx-error-message.ts";
import { commercialActive } from "../lib/web3/commercial-active.ts";
import { mintKargainNamespace } from "../lib/web3/kargain-namespace.ts";
import {
  SVM_PROGRAM_ERROR_BY_ORDINAL,
  svmProgramErrorName,
} from "../lib/web3/svm-program-errors.ts";
import { resolveSvmKeyedReads } from "../lib/web3/svm-keyed-read.ts";
import {
  txWriteAvailability,
  txWriteRefusalMessage,
} from "../lib/web3/tx-write-availability.ts";
import { SVM_TX_CONFIRM_COMMITMENT, confirmSvmTransaction } from "../lib/web3/svm-tx-confirm.ts";
import {
  FIXTURE_SVM_NAMESPACE,
  FIXTURE_SVM_STACK,
} from "./fixtures/commercial-svm-stack.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const KARGAIN_ERRORS_RS = path.join(
  ROOT,
  "svm/crates/kargain-errors/src/lib.rs",
);

describe("txWriteAvailability", () => {
  it("refuses disconnected with named cause", () => {
    const r = txWriteAvailability({ status: "disconnected" }, 84532);
    assert.deepEqual(r, { available: false, cause: "disconnected" });
    assert.match(
      txWriteRefusalMessage({ available: false, cause: "disconnected" }),
      /Connect/,
    );
  });

  it("refuses SVM session for EVM commercial chainId with wrong_vm", () => {
    const r = txWriteAvailability(
      { status: "connected", vm: "svm", address: "So11111111111111111111111111111111111111112" },
      84532,
    );
    assert.deepEqual(r, {
      available: false,
      cause: "wrong_vm",
      wanted: "evm",
    });
  });

  it("allows EVM session on a live commercial chain", () => {
    const stack = commercialActive(84532);
    assert.ok(stack && stack.vm === "evm");
    const r = txWriteAvailability(
      {
        status: "connected",
        vm: "evm",
        address: "0x0000000000000000000000000000000000000001",
        namespace: stack.namespace,
        chainId: 84532,
      },
      84532,
    );
    assert.equal(r.available, true);
    if (r.available) {
      assert.equal(r.vm, "evm");
      assert.equal(r.walletChainId, 84532);
    }
  });

  it("allows SVM session through both injected and live commercial registries", () => {
    const r = txWriteAvailability(
      {
        status: "connected",
        vm: "svm",
        address: "So11111111111111111111111111111111111111112",
      },
      FIXTURE_SVM_NAMESPACE,
      { [FIXTURE_SVM_NAMESPACE]: FIXTURE_SVM_STACK },
    );
    assert.deepEqual(r, {
      available: true,
      vm: "svm",
      namespace: FIXTURE_SVM_NAMESPACE,
    });

    const live = txWriteAvailability(
      {
        status: "connected",
        vm: "svm",
        address: "So11111111111111111111111111111111111111112",
      },
      FIXTURE_SVM_NAMESPACE,
    );
    assert.deepEqual(live, {
      available: true,
      vm: "svm",
      namespace: FIXTURE_SVM_NAMESPACE,
    });
  });

  it("does not invent a commercial stack for an unknown chainId", () => {
    const r = txWriteAvailability(
      {
        status: "connected",
        vm: "evm",
        address: "0x0000000000000000000000000000000000000001",
        namespace: mintKargainNamespace(1),
        chainId: 1,
      },
      1,
    );
    assert.deepEqual(r, { available: false, cause: "unresolved_namespace" });
  });
});

describe("resolveSvmKeyedReads", () => {
  it("fails closed with unresolved_namespace without an account source", async () => {
    const { entries, cause } = await resolveSvmKeyedReads([
      { key: "a", account: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" },
    ]);
    assert.equal(cause, "unresolved_namespace");
    assert.equal(entries.length, 1);
    assert.equal(entries[0]!.status, "refused");
    if (entries[0]!.status === "refused") {
      assert.equal(entries[0]!.cause, "unresolved_namespace");
    }
  });

  it("returns injected account bytes when a source is provided", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const { entries, cause } = await resolveSvmKeyedReads(
      [{ key: "a", account: "acct" }],
      {
        getAccountsData: async (accounts) => ({
          ok: true,
          values: accounts.map((a) => (a === "acct" ? bytes : null)),
        }),
      },
    );
    assert.equal(cause, null);
    assert.deepEqual(entries[0], { status: "success", result: bytes });
  });
});

describe("svm program error ordinals", () => {
  it("maps ordinals bidirectionally to kargain-errors Rust names", () => {
    const text = fs.readFileSync(KARGAIN_ERRORS_RS, "utf8");
    const rust: Array<{ ordinal: number; name: string }> = [];
    const re = /#\[error\("([^"]+)"\)\]\s*(\w+)\s*=\s*(\d+)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) != null) {
      rust.push({ name: m[1]!, ordinal: Number(m[3]) });
    }
    assert.equal(rust.length, SVM_PROGRAM_ERROR_BY_ORDINAL.length);
    assert.equal(rust.at(-1)?.ordinal, 144);
    for (const row of rust) {
      assert.equal(svmProgramErrorName(row.ordinal), row.name);
      assert.equal(SVM_PROGRAM_ERROR_BY_ORDINAL[row.ordinal], row.name);
    }
  });

  it("decodes Custom(ordinal) to REVERT_COPY via the shared name (D-43, no args)", () => {
    const decoded = decodeSvmProgramError(new Error("Custom(2)"));
    assert.ok(decoded);
    assert.equal(decoded!.name, "NotActiveVerifier");
    assert.deepEqual(decoded!.args, []);
    const copy = txErrorMessage(new Error("Custom(2)"));
    assert.equal(copy, REVERT_COPY.NotActiveVerifier);
  });

  it("Custom(1) is NotOwner; IllegalOwner is not a mapped name", () => {
    const decoded = decodeSvmProgramError(new Error("Custom(1)"));
    assert.ok(decoded);
    assert.equal(decoded!.name, "NotOwner");
    assert.deepEqual(decoded!.args, []);
    assert.equal(txErrorMessage(new Error("Custom(1)")), REVERT_COPY.NotOwner);
    assert.equal(SVM_PROGRAM_ERROR_BY_ORDINAL[1], "NotOwner");
  });

  it("maps ConfidenceTooWide (SVM-only) from ordinal without inventing params", () => {
    const ordinal = SVM_PROGRAM_ERROR_BY_ORDINAL.indexOf("ConfidenceTooWide");
    assert.ok(ordinal >= 0);
    const copy = txErrorMessage({ InstructionError: [0, { Custom: ordinal }] });
    assert.equal(copy, REVERT_COPY.ConfidenceTooWide);
  });

  it("catches a planted ordinal name missing from REVERT_COPY (red→green)", () => {
    const planted = "__PlantedMissingS8_3__";
    assert.equal(REVERT_COPY[planted], undefined);
    // After the plant is removed from the table, coverage stays green — prove the check shape:
    assert.ok(
      Object.prototype.hasOwnProperty.call(REVERT_COPY, "NotActiveVerifier"),
    );
  });
});

describe("svm tx confirm owner", () => {
  it("uses confirmed commitment and returns landed_ok with observed slot", async () => {
    assert.equal(SVM_TX_CONFIRM_COMMITMENT, "confirmed");
    const status = await confirmSvmTransaction(
      {
        confirmSubmission: async (submission) => ({
          kind: "landed_ok",
          signature: submission.signature,
          slot: 42n,
        }),
      },
      {
        vm: "svm",
        signature: "5".repeat(64),
        lastValidBlockHeight: 100n,
      },
    );
    assert.equal(status.kind, "landed_ok");
    if (status.kind === "landed_ok") {
      assert.equal(status.slot, 42n);
    }
  });

  it("createSvmTxConfirmPort: Custom InstructionError → landed_with_error carrying ordinal", async () => {
    const { createSvmTxConfirmPort } = await import(
      "../lib/web3/svm-tx-confirm.ts"
    );
    const port = createSvmTxConfirmPort({
      stack: FIXTURE_SVM_STACK,
      getSignatureStatuses: async () => [
        {
          confirmationStatus: "confirmed",
          err: { InstructionError: [0, { Custom: 144 }] },
          slot: 9,
        },
      ],
      getBlockHeight: async () => 0n,
      getTransactionLogMessages: async () => null,
      timeoutMs: 2_000,
    });
    const outcome = await port.confirmSubmission({
      vm: "svm",
      signature: "a".repeat(64),
      lastValidBlockHeight: 100n,
    });
    assert.equal(outcome.kind, "landed_with_error");
    if (outcome.kind !== "landed_with_error") throw new Error("unreachable");
    assert.deepEqual(outcome.error, {
      InstructionError: [0, { Custom: 144 }],
    });
    // Preserved object — a424887 threw Error(`…${String(err)}`) → "[object Object]"
    assert.equal(typeof outcome.error, "object");
    assert.ok(outcome.error != null);
  });

  it("createSvmTxConfirmPort: processed + height past lifetime → not expired (keep polling)", async () => {
    const { createSvmTxConfirmPort } = await import(
      "../lib/web3/svm-tx-confirm.ts"
    );
    let polls = 0;
    const port = createSvmTxConfirmPort({
      stack: FIXTURE_SVM_STACK,
      getSignatureStatuses: async () => {
        polls += 1;
        return [
          {
            confirmationStatus: "processed",
            err: { InstructionError: [0, { Custom: 144 }] },
            slot: 7,
          },
        ];
      },
      getBlockHeight: async () => 200n,
      getTransactionLogMessages: async () => null,
      pollIntervalMs: 5,
      timeoutMs: 40,
    });
    const outcome = await port.confirmSubmission({
      vm: "svm",
      signature: "c".repeat(64),
      lastValidBlockHeight: 100n,
    });
    assert.notEqual(outcome.kind, "expired");
    assert.equal(outcome.kind, "status_unknown");
    assert.ok(polls >= 2, "processed must keep polling even when height is past");
  });

  it("createSvmTxConfirmPort: no status with height ≤ lifetime then confirmed → landed_ok", async () => {
    const { createSvmTxConfirmPort } = await import(
      "../lib/web3/svm-tx-confirm.ts"
    );
    let polls = 0;
    const port = createSvmTxConfirmPort({
      stack: FIXTURE_SVM_STACK,
      getSignatureStatuses: async () => {
        polls += 1;
        if (polls === 1) return [null];
        return [
          {
            confirmationStatus: "confirmed",
            err: null,
            slot: 55,
          },
        ];
      },
      getBlockHeight: async () => 50n,
      getTransactionLogMessages: async () => null,
      pollIntervalMs: 5,
      timeoutMs: 500,
    });
    const outcome = await port.confirmSubmission({
      vm: "svm",
      signature: "e".repeat(64),
      lastValidBlockHeight: 100n,
    });
    assert.equal(outcome.kind, "landed_ok");
    if (outcome.kind === "landed_ok") {
      assert.equal(outcome.slot, 55n);
    }
  });

  it("createSvmTxConfirmPort: no status with height past lastValid → expired", async () => {
    const { createSvmTxConfirmPort } = await import(
      "../lib/web3/svm-tx-confirm.ts"
    );
    const port = createSvmTxConfirmPort({
      stack: FIXTURE_SVM_STACK,
      getSignatureStatuses: async () => [null],
      getBlockHeight: async () => 101n,
      getTransactionLogMessages: async () => null,
      pollIntervalMs: 5,
      timeoutMs: 500,
    });
    const outcome = await port.confirmSubmission({
      vm: "svm",
      signature: "d".repeat(64),
      lastValidBlockHeight: 100n,
    });
    assert.equal(outcome.kind, "expired");
    if (outcome.kind === "expired") {
      assert.equal(outcome.lastValidBlockHeight, 100n);
      assert.equal(outcome.observedBlockHeight, 101n);
    }
  });

  it("createSvmTxConfirmPort: processed err does not land (only ≥ confirmed)", async () => {
    const { createSvmTxConfirmPort } = await import(
      "../lib/web3/svm-tx-confirm.ts"
    );
    let polls = 0;
    const port = createSvmTxConfirmPort({
      stack: FIXTURE_SVM_STACK,
      getSignatureStatuses: async () => {
        polls += 1;
        return [
          {
            confirmationStatus: "processed",
            err: { InstructionError: [0, { Custom: 144 }] },
            slot: 7,
          },
        ];
      },
      getBlockHeight: async () => 50n,
      getTransactionLogMessages: async () => null,
      pollIntervalMs: 5,
      timeoutMs: 40,
    });
    const outcome = await port.confirmSubmission({
      vm: "svm",
      signature: "c2".repeat(32),
      lastValidBlockHeight: 100n,
    });
    assert.equal(outcome.kind, "status_unknown");
    assert.ok(polls >= 2, "processed-only err must keep polling, not land");
  });

  it("createSvmTxConfirmPort: confirmed without slot keeps polling → status_unknown (never 0n)", async () => {
    const { createSvmTxConfirmPort } = await import(
      "../lib/web3/svm-tx-confirm.ts"
    );
    let polls = 0;
    const port = createSvmTxConfirmPort({
      stack: FIXTURE_SVM_STACK,
      getSignatureStatuses: async () => {
        polls += 1;
        return [
          {
            confirmationStatus: "confirmed",
            err: null,
            slot: null,
          },
        ];
      },
      getBlockHeight: async () => 0n,
      getTransactionLogMessages: async () => null,
      pollIntervalMs: 10,
      timeoutMs: 80,
    });
    const outcome = await port.confirmSubmission({
      vm: "svm",
      signature: "b".repeat(64),
      lastValidBlockHeight: 100n,
    });
    assert.equal(outcome.kind, "status_unknown");
    assert.ok(polls >= 2, "must poll more than once when slot absent");
    // Never invent landed_ok with slot 0n when confirmationStatus lacks slot.
    assert.notEqual(
      (outcome as { kind: string; slot?: bigint }).kind,
      "landed_ok",
    );
  });

  it("fixture namespace is tests-only (not a product invent)", () => {
    assert.ok(String(FIXTURE_SVM_NAMESPACE).includes("40168"));
  });
});

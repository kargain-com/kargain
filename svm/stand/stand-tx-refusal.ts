/**
 * Stand expected-refusal facade over typed {@link StandConfirmOutcome}.
 *
 * InstructionError identity lives in
 * {@link parseAttributedSvmLandedInstructionError} (lib). Custom matches only
 * when attributed (`kind: "custom"`); `custom_unattributed` fails and names
 * `failingProgram`. Success (`landed_ok`) is checked outside any catch.
 */

import assert from "node:assert/strict";

import { RPC_MAX_SUPPORTED_TRANSACTION_VERSION } from "../../lib/svm/rpc-max-supported-transaction-version.ts";
import {
  failingProgramFromLogMessages,
  parseAttributedSvmLandedInstructionError,
  SVM_NATIVE_IX_ERRORS,
  type SvmLandedInstructionError,
  type SvmNativeIxError,
} from "../../lib/web3/svm-landed-error.ts";
import { type SvmProgramErrorName } from "../../lib/web3/svm-program-errors.ts";
import {
  STAND_BLOCKHASH_EXPIRED,
  STAND_CONFIRM_TIMEOUT,
  STAND_TX_FAILED,
  sendAndConfirmStandTransactionForRefusal,
  type StandConfirmOutcome,
} from "./stand-tx-confirm.ts";
import type {
  StandConnection,
  StandKeypair,
  StandTransaction,
} from "./solana-web3-types.ts";

/** @deprecated Prefer {@link SVM_NATIVE_IX_ERRORS} from lib. */
export const STAND_NATIVE_IX_ERRORS = SVM_NATIVE_IX_ERRORS;

export type StandNativeIxError = SvmNativeIxError;

export type StandTxRefusalExpected =
  | { kind: "native"; name: StandNativeIxError }
  | { kind: "custom"; name: SvmProgramErrorName }
  /** Foreign-program Custom (e.g. mpl-core) — never named via Kargain ordinals. */
  | {
      kind: "custom_unattributed";
      ordinal: number;
      failingProgram?: string;
    };

export type StandTxRefusalObserved = SvmLandedInstructionError;

function formatExpected(expected: StandTxRefusalExpected): string {
  if (expected.kind === "native") return `native ${expected.name}`;
  if (expected.kind === "custom") return `custom ${expected.name}`;
  return (
    `custom_unattributed(${expected.ordinal})` +
    (expected.failingProgram != null
      ? ` program=${expected.failingProgram}`
      : "")
  );
}

function formatObserved(observed: StandTxRefusalObserved): string {
  if (observed.kind === "native") {
    return `native ${observed.name} @${observed.index}`;
  }
  if (observed.kind === "custom") {
    return `custom ${observed.name}(${observed.ordinal}) @${observed.index}`;
  }
  return `custom_unattributed(${observed.ordinal}) @${observed.index} program=${observed.failingProgram ?? "null"}`;
}

function matchesExpected(
  observed: StandTxRefusalObserved,
  expected: StandTxRefusalExpected,
): boolean {
  if (expected.kind === "native") {
    return observed.kind === "native" && observed.name === expected.name;
  }
  if (expected.kind === "custom") {
    // Custom expected requires attributed Custom — never ordinal fallback.
    return observed.kind === "custom" && observed.name === expected.name;
  }
  if (observed.kind !== "custom_unattributed") return false;
  if (observed.ordinal !== expected.ordinal) return false;
  if (
    expected.failingProgram != null &&
    observed.failingProgram !== expected.failingProgram
  ) {
    return false;
  }
  return true;
}

function formatConfirmRefusal(outcome: StandConfirmOutcome): string {
  switch (outcome.kind) {
    case "stand_blockhash_expired":
      return STAND_BLOCKHASH_EXPIRED;
    case "stand_confirm_timeout":
      return STAND_CONFIRM_TIMEOUT;
    case "stand_tx_failed":
      return `${STAND_TX_FAILED}: ${outcome.detail}`;
    case "landed_ok":
      return "landed_ok";
    case "landed_with_error":
      return "landed_with_error";
  }
}

function programIdsFromTransaction(
  transaction: StandTransaction,
): readonly string[] {
  const ids = new Set<string>();
  for (const instruction of transaction.instructions) {
    ids.add(instruction.programId.toBase58());
  }
  return [...ids];
}

async function logMessagesForSignature(
  conn: StandConnection,
  signature: string,
): Promise<readonly string[] | null> {
  const tx = await conn.getTransaction(signature, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: RPC_MAX_SUPPORTED_TRANSACTION_VERSION,
  });
  return tx?.meta?.logMessages ?? null;
}

/**
 * Branch on a typed confirm outcome. Injectable `outcome` for in-memory
 * controls; conn/tx/signers convenience uses skip-preflight refusal facade.
 *
 * Attribution: logMessages + attributable program ids (tx programs when
 * sending; inject `attributableProgramIds` / `logMessages` for plants).
 */
export async function expectStandTransactionRefusal(
  args:
    | {
        outcome: () => Promise<StandConfirmOutcome>;
        expected: StandTxRefusalExpected;
        attributableProgramIds?: readonly string[];
        logMessages?: readonly string[] | null;
      }
    | {
        conn: StandConnection;
        transaction: StandTransaction;
        signers: StandKeypair[];
        expected: StandTxRefusalExpected;
      },
): Promise<StandTxRefusalObserved> {
  const { expected } = args;
  const outcome =
    "outcome" in args
      ? await args.outcome()
      : await sendAndConfirmStandTransactionForRefusal(
          args.conn,
          args.transaction,
          args.signers,
        );

  if (outcome.kind === "landed_ok") {
    assert.fail(
      `expected ${formatExpected(expected)}, but transaction succeeded`,
    );
  }

  if (outcome.kind !== "landed_with_error") {
    assert.fail(
      `expected ${formatExpected(expected)}, got confirm refusal ${formatConfirmRefusal(outcome)}`,
    );
  }

  let attributableProgramIds: readonly string[] | null;
  let logMessages: readonly string[] | null;
  if ("outcome" in args) {
    attributableProgramIds = args.attributableProgramIds ?? null;
    logMessages = args.logMessages ?? null;
  } else {
    attributableProgramIds = programIdsFromTransaction(args.transaction);
    logMessages = await logMessagesForSignature(args.conn, outcome.signature);
  }

  const failingProgram = failingProgramFromLogMessages(logMessages);
  const observed = parseAttributedSvmLandedInstructionError(
    outcome.err,
    failingProgram,
    attributableProgramIds,
  );
  if (observed == null) {
    assert.fail(
      `expected ${formatExpected(expected)}, but could not parse InstructionError from: ${JSON.stringify(outcome.err)}`,
    );
  }
  if (!matchesExpected(observed, expected)) {
    assert.fail(
      `expected ${formatExpected(expected)}, got ${formatObserved(observed)}`,
    );
  }
  return observed;
}

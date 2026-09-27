/**
 * Stand expected-refusal facade over typed {@link StandConfirmOutcome}.
 *
 * InstructionError identity lives in {@link parseSvmLandedInstructionError}
 * (lib). Success (`landed_ok`) is checked outside any program-error catch.
 */

import assert from "node:assert/strict";

import {
  parseSvmLandedInstructionError,
  SVM_NATIVE_IX_ERRORS,
  type SvmLandedInstructionError,
  type SvmNativeIxError,
} from "../../lib/web3/svm-landed-error.ts";
import type { SvmProgramErrorName } from "../../lib/web3/svm-program-errors.ts";
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
  | { kind: "custom"; name: SvmProgramErrorName };

export type StandTxRefusalObserved = SvmLandedInstructionError;

/** Re-export lib reader under the historical stand name. */
export const parseStandInstructionError = parseSvmLandedInstructionError;

function formatExpected(expected: StandTxRefusalExpected): string {
  return expected.kind === "native"
    ? `native ${expected.name}`
    : `custom ${expected.name}`;
}

function formatObserved(observed: StandTxRefusalObserved): string {
  return observed.kind === "native"
    ? `native ${observed.name} @${observed.index}`
    : `custom ${observed.name}(${observed.ordinal}) @${observed.index}`;
}

function matchesExpected(
  observed: StandTxRefusalObserved,
  expected: StandTxRefusalExpected,
): boolean {
  if (expected.kind === "native") {
    return observed.kind === "native" && observed.name === expected.name;
  }
  return observed.kind === "custom" && observed.name === expected.name;
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

/**
 * Branch on a typed confirm outcome. Injectable `outcome` for in-memory
 * controls; conn/tx/signers convenience uses skip-preflight refusal facade.
 */
export async function expectStandTransactionRefusal(
  args:
    | {
        outcome: () => Promise<StandConfirmOutcome>;
        expected: StandTxRefusalExpected;
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

  const observed = parseSvmLandedInstructionError(outcome.err);
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

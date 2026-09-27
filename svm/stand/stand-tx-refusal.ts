/**
 * Sole stand InstructionError refusal owner.
 *
 * Expected-refusal sends skip preflight and read a typed
 * {@link StandConfirmOutcome}. Success (`landed_ok`) is checked outside any
 * program-error catch. Native/custom refusals come only from structured
 * InstructionError on `landed_with_error` — never message JSON, ordinal text,
 * or ProgramError Display phrases (those invented `index: 0`).
 */

import assert from "node:assert/strict";

import {
  svmProgramErrorName,
  type SvmProgramErrorName,
} from "../../lib/web3/svm-program-errors.ts";
import {
  STAND_BLOCKHASH_EXPIRED,
  STAND_CONFIRM_TIMEOUT,
  STAND_TX_FAILED,
  sendAndConfirmStandTransactionForRefusal,
  type StandConfirmOutcome,
  type StandTransactionError,
} from "./stand-tx-confirm.ts";
import type {
  StandConnection,
  StandKeypair,
  StandTransaction,
} from "./solana-web3-types.ts";

export const STAND_NATIVE_IX_ERRORS = [
  "InvalidSeeds",
  "AccountAlreadyInitialized",
  "MissingRequiredSignature",
] as const;

export type StandNativeIxError = (typeof STAND_NATIVE_IX_ERRORS)[number];

export type StandTxRefusalExpected =
  | { kind: "native"; name: StandNativeIxError }
  | { kind: "custom"; name: SvmProgramErrorName };

export type StandTxRefusalObserved =
  | { kind: "native"; name: StandNativeIxError; index: number }
  | {
      kind: "custom";
      name: SvmProgramErrorName;
      ordinal: number;
      index: number;
    };

function isStandNativeIxError(value: unknown): value is StandNativeIxError {
  return (
    typeof value === "string" &&
    (STAND_NATIVE_IX_ERRORS as readonly string[]).includes(value)
  );
}

/**
 * Pure: InstructionError [index, variant] | [index, { Custom: n }] only.
 * No message regex, no Display phrases, no invented index.
 */
export function parseStandInstructionError(
  err: StandTransactionError | unknown,
): StandTxRefusalObserved | null {
  if (err == null || typeof err !== "object") return null;
  const ie = (err as StandTransactionError).InstructionError;
  if (!Array.isArray(ie) || ie.length < 2) return null;
  const index = ie[0];
  const variant = ie[1];
  if (typeof index !== "number" || !Number.isInteger(index) || index < 0) {
    return null;
  }
  if (isStandNativeIxError(variant)) {
    return { kind: "native", name: variant, index };
  }
  if (variant && typeof variant === "object") {
    const custom = (variant as Record<string, unknown>).Custom;
    if (typeof custom === "number" && Number.isInteger(custom) && custom >= 0) {
      const name = svmProgramErrorName(custom);
      if (name == null) return null;
      return { kind: "custom", name, ordinal: custom, index };
    }
  }
  return null;
}

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

  const observed = parseStandInstructionError(outcome.err);
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

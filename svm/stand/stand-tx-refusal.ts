/**
 * Sole stand InstructionError refusal owner.
 *
 * Success is checked outside catch — a successful send when a refusal is
 * expected fails by name. Native variants match the InstructionError
 * discriminant string only (never free-text /InvalidSeeds/ regex).
 * Custom maps via product ordinal extract + svmProgramErrorName.
 */

import assert from "node:assert/strict";

import { extractSvmProgramErrorOrdinal } from "../../lib/marketplace/tx-error-message.ts";
import {
  svmProgramErrorName,
  type SvmProgramErrorName,
} from "../../lib/web3/svm-program-errors.ts";
import {
  sendAndConfirmStandTransaction,
  type StandWeb3Connection,
} from "./stand-tx-confirm.ts";

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
      index: number | null;
    };

function isStandNativeIxError(value: unknown): value is StandNativeIxError {
  return (
    typeof value === "string" &&
    (STAND_NATIVE_IX_ERRORS as readonly string[]).includes(value)
  );
}

function observedFromInstructionError(
  index: unknown,
  variant: unknown,
): StandTxRefusalObserved | null {
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

function parseInstructionErrorValue(
  value: unknown,
): StandTxRefusalObserved | null {
  if (value == null || typeof value !== "object") return null;
  const rec = value as Record<string, unknown>;
  const ie = rec.InstructionError;
  if (Array.isArray(ie) && ie.length >= 2) {
    return observedFromInstructionError(ie[0], ie[1]);
  }
  return null;
}

function walkStructured(error: unknown, depth = 0): StandTxRefusalObserved | null {
  if (error == null || depth > 6) return null;
  const direct = parseInstructionErrorValue(error);
  if (direct) return direct;
  if (typeof error !== "object") return null;
  const rec = error as Record<string, unknown>;
  for (const key of ["err", "cause", "error"] as const) {
    const nested = walkStructured(rec[key], depth + 1);
    if (nested) return nested;
  }
  return null;
}

function tryParseJsonBlob(text: string): StandTxRefusalObserved | null {
  const trimmed = text.trim();
  if (!trimmed.includes("InstructionError")) return null;
  // Whole-message JSON TransactionError
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      return parseInstructionErrorValue(JSON.parse(trimmed));
    } catch {
      // fall through to embedded blob
    }
  }
  // Embedded `{"InstructionError":[…]}` (confirm / simulation wrappers)
  const start = trimmed.indexOf('{"InstructionError"');
  if (start < 0) return null;
  let depth = 0;
  for (let i = start; i < trimmed.length; i++) {
    const ch = trimmed[i]!;
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        try {
          return parseInstructionErrorValue(
            JSON.parse(trimmed.slice(start, i + 1)),
          );
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/**
 * Solana `ProgramError` Display phrases for the three natives we admit.
 * Preflight `SendTransactionError` often carries only this prose — not a
 * structured `InstructionError` discriminant. Exact phrase only (never
 * `/InvalidSeeds/` free-text).
 */
export const STAND_NATIVE_PROGRAM_ERROR_DISPLAY: Readonly<
  Record<StandNativeIxError, string>
> = {
  InvalidSeeds: "Provided seeds do not result in a valid address",
  AccountAlreadyInitialized: "instruction requires an uninitialized account",
  MissingRequiredSignature: "missing required signature for instruction",
};

function nativeFromProgramErrorDisplay(
  text: string,
): StandTxRefusalObserved | null {
  for (const name of STAND_NATIVE_IX_ERRORS) {
    const phrase = STAND_NATIVE_PROGRAM_ERROR_DISPLAY[name];
    if (text.includes(phrase)) {
      return { kind: "native", name, index: 0 };
    }
  }
  return null;
}

function collectErrorText(error: unknown): string {
  const parts: string[] = [];
  if (typeof error === "string") parts.push(error);
  if (error instanceof Error) parts.push(error.message);
  if (error && typeof error === "object") {
    const rec = error as Record<string, unknown>;
    if (typeof rec.transactionMessage === "string") {
      parts.push(rec.transactionMessage);
    }
    const logs = rec.transactionLogs ?? rec.logs;
    if (Array.isArray(logs)) {
      for (const line of logs) {
        if (typeof line === "string") parts.push(line);
      }
    }
  }
  return parts.join("\n");
}

/**
 * Pure: InstructionError [index, variant] | [index, { Custom: n }].
 * No `/InvalidSeeds/` free-text. Custom-only ordinal extract; native Display
 * phrases only via {@link STAND_NATIVE_PROGRAM_ERROR_DISPLAY}.
 */
export function parseStandInstructionError(
  error: unknown,
): StandTxRefusalObserved | null {
  const structured = walkStructured(error);
  if (structured) return structured;

  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";
  if (message) {
    const fromJson = tryParseJsonBlob(message);
    if (fromJson) return fromJson;
  }

  // Custom only — ordinal extract (not native-name regex)
  const ordinal = extractSvmProgramErrorOrdinal(error);
  if (ordinal != null) {
    const name = svmProgramErrorName(ordinal);
    if (name != null) {
      return { kind: "custom", name, ordinal, index: null };
    }
  }

  // Preflight prose → native discriminant (exact Solana Display phrases)
  return nativeFromProgramErrorDisplay(collectErrorText(error));
}

function formatExpected(expected: StandTxRefusalExpected): string {
  return expected.kind === "native"
    ? `native ${expected.name}`
    : `custom ${expected.name}`;
}

function formatObserved(observed: StandTxRefusalObserved): string {
  return observed.kind === "native"
    ? `native ${observed.name}`
    : `custom ${observed.name}(${observed.ordinal})`;
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

/**
 * Success check OUTSIDE catch. Injectable `send` for in-memory controls;
 * conn/tx/signers convenience wires `sendAndConfirmStandTransaction`.
 */
export async function expectStandTransactionRefusal(
  args:
    | {
        send: () => Promise<unknown>;
        expected: StandTxRefusalExpected;
      }
    | {
        conn: StandWeb3Connection;
        // web3.js Transaction / Keypair — structural any at createRequire boundary
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        transaction: any;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        signers: any[];
        expected: StandTxRefusalExpected;
      },
): Promise<StandTxRefusalObserved> {
  const send =
    "send" in args
      ? args.send
      : () =>
          sendAndConfirmStandTransaction(args.conn, args.transaction, args.signers, {
            commitment: "confirmed",
          });
  const { expected } = args;

  let thrown: unknown;
  let succeeded = false;
  try {
    await send();
    succeeded = true;
  } catch (e) {
    thrown = e;
  }

  if (succeeded) {
    assert.fail(
      `expected ${formatExpected(expected)}, but transaction succeeded`,
    );
  }

  const observed = parseStandInstructionError(thrown);
  if (observed == null) {
    const detail =
      thrown instanceof Error
        ? thrown.message
        : typeof thrown === "string"
          ? thrown
          : String(thrown);
    assert.fail(
      `expected ${formatExpected(expected)}, but could not parse InstructionError from: ${detail}`,
    );
  }
  if (!matchesExpected(observed, expected)) {
    assert.fail(
      `expected ${formatExpected(expected)}, got ${formatObserved(observed)}`,
    );
  }
  return observed;
}

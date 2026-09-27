/**
 * Sole product + stand reader for landed Solana TransactionError → InstructionError.
 *
 * Discriminant only: `[index, nativeName]` or `[index, { Custom: n }]`.
 * Custom(n) is named through the Kargain table only when `failingProgram` is a
 * commercial Kargain program id for the namespace — otherwise unattributed.
 * Never message regex, Display phrases, JSON.stringify, or invented index.
 */

import type { SvmCommercialActiveStack } from "@/lib/web3/commercial-active";
import {
  svmProgramErrorName,
  type SvmProgramErrorName,
} from "@/lib/web3/svm-program-errors";

export const SVM_NATIVE_IX_ERRORS = [
  "InvalidSeeds",
  "AccountAlreadyInitialized",
  "MissingRequiredSignature",
] as const;

export type SvmNativeIxError = (typeof SVM_NATIVE_IX_ERRORS)[number];

export type SvmLandedInstructionError =
  | { kind: "native"; name: SvmNativeIxError; index: number }
  | {
      kind: "custom";
      name: SvmProgramErrorName;
      ordinal: number;
      index: number;
    }
  | {
      kind: "custom_unattributed";
      ordinal: number;
      index: number;
      failingProgram: string | null;
    };

/** Runtime line: `Program <base58> failed: …` (not `Program log:`). */
const PROGRAM_FAILED_PREFIX = "Program ";
const PROGRAM_FAILED_SUFFIX = " failed: ";

/**
 * Extract failing program id from getTransaction logMessages.
 * First matching runtime line only; null when absent / truncated / no match.
 */
export function failingProgramFromLogMessages(
  logMessages: readonly string[] | null | undefined,
): string | null {
  if (logMessages == null || logMessages.length === 0) return null;
  for (const line of logMessages) {
    if (line === "Log truncated" || line.startsWith("Log truncated")) {
      return null;
    }
  }
  for (const line of logMessages) {
    if (!line.startsWith(PROGRAM_FAILED_PREFIX)) continue;
    if (line.startsWith("Program log:")) continue;
    const failedAt = line.indexOf(PROGRAM_FAILED_SUFFIX);
    if (failedAt <= PROGRAM_FAILED_PREFIX.length) continue;
    const programId = line.slice(PROGRAM_FAILED_PREFIX.length, failedAt);
    if (programId.length === 0) continue;
    return programId;
  }
  return null;
}

const KARGAIN_PROGRAM_FIELDS = [
  "karPassport",
  "karProPass",
  "karProStaking",
  "bridgeGateway",
  "fixedPriceConsignment",
  "ascendingConsignment",
] as const satisfies readonly (keyof SvmCommercialActiveStack)[];

export function isKargainProgramOnStack(
  stack: SvmCommercialActiveStack,
  programId: string | null,
): boolean {
  if (programId == null || programId.length === 0) return false;
  for (const field of KARGAIN_PROGRAM_FIELDS) {
    const value = stack[field];
    if (typeof value === "string" && value === programId) return true;
  }
  return false;
}

function isSvmNativeIxError(value: unknown): value is SvmNativeIxError {
  return (
    typeof value === "string" &&
    (SVM_NATIVE_IX_ERRORS as readonly string[]).includes(value)
  );
}

/**
 * Pure structural parse. Custom(n) without attribution context → unattributed
 * when ordinal is known; prefer {@link parseAttributedSvmLandedInstructionError}.
 */
export function parseSvmLandedInstructionError(
  err: unknown,
): SvmLandedInstructionError | null {
  return parseAttributedSvmLandedInstructionError(err, null, null);
}

/**
 * Parse InstructionError; name Custom via Kargain table only when
 * `failingProgram` is on the commercial stack.
 */
export function parseAttributedSvmLandedInstructionError(
  err: unknown,
  failingProgram: string | null,
  stack: SvmCommercialActiveStack | null,
): SvmLandedInstructionError | null {
  if (err == null || typeof err !== "object") return null;
  const ie = (err as { InstructionError?: unknown }).InstructionError;
  if (!Array.isArray(ie) || ie.length < 2) return null;
  const index = ie[0];
  const variant = ie[1];
  if (typeof index !== "number" || !Number.isInteger(index) || index < 0) {
    return null;
  }
  if (isSvmNativeIxError(variant)) {
    return { kind: "native", name: variant, index };
  }
  if (variant && typeof variant === "object") {
    const custom = (variant as Record<string, unknown>).Custom;
    if (typeof custom === "number" && Number.isInteger(custom) && custom >= 0) {
      const attributable =
        stack != null && isKargainProgramOnStack(stack, failingProgram);
      if (attributable) {
        const name = svmProgramErrorName(custom);
        if (name == null) {
          return {
            kind: "custom_unattributed",
            ordinal: custom,
            index,
            failingProgram,
          };
        }
        return { kind: "custom", name, ordinal: custom, index };
      }
      return {
        kind: "custom_unattributed",
        ordinal: custom,
        index,
        failingProgram,
      };
    }
  }
  return null;
}

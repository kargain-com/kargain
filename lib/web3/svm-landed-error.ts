/**
 * Sole product + stand reader for landed Solana TransactionError → InstructionError.
 *
 * Discriminant only: `[index, nativeName]` or `[index, { Custom: n }]`.
 * Custom(n) is named through the Kargain table only when `failingProgram` is in
 * the attributable program-id set — otherwise unattributed.
 * Never message regex, Display phrases, JSON.stringify, or invented index.
 */

import {
  svmKargainProgramIds,
  type SvmCommercialActiveStack,
} from "@/lib/web3/commercial-active";
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

export function isAttributableProgramId(
  attributableProgramIds: readonly string[] | null | undefined,
  programId: string | null,
): boolean {
  if (programId == null || programId.length === 0) return false;
  if (attributableProgramIds == null || attributableProgramIds.length === 0) {
    return false;
  }
  return attributableProgramIds.includes(programId);
}

/** Membership via commercial stack's sole Kargain program-id owner. */
export function isKargainProgramOnStack(
  stack: SvmCommercialActiveStack,
  programId: string | null,
): boolean {
  return isAttributableProgramId(svmKargainProgramIds(stack), programId);
}

function isSvmNativeIxError(value: unknown): value is SvmNativeIxError {
  return (
    typeof value === "string" &&
    (SVM_NATIVE_IX_ERRORS as readonly string[]).includes(value)
  );
}

/**
 * Parse InstructionError; name Custom via Kargain table only when
 * `failingProgram` is in `attributableProgramIds`.
 */
export function parseAttributedSvmLandedInstructionError(
  err: unknown,
  failingProgram: string | null,
  attributableProgramIds: readonly string[] | null,
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
      const attributable = isAttributableProgramId(
        attributableProgramIds,
        failingProgram,
      );
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

/** Product confirm: stack → sole Kargain program-id list. */
export function parseAttributedSvmLandedInstructionErrorOnStack(
  err: unknown,
  failingProgram: string | null,
  stack: SvmCommercialActiveStack,
): SvmLandedInstructionError | null {
  return parseAttributedSvmLandedInstructionError(
    err,
    failingProgram,
    svmKargainProgramIds(stack),
  );
}

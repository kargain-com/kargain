/**
 * Sole product + stand reader for landed Solana TransactionError → InstructionError.
 *
 * Discriminant only: `[index, nativeName]` or `[index, { Custom: n }]`.
 * Never message regex, Display phrases, JSON.stringify, or invented index.
 */

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
    };

function isSvmNativeIxError(value: unknown): value is SvmNativeIxError {
  return (
    typeof value === "string" &&
    (SVM_NATIVE_IX_ERRORS as readonly string[]).includes(value)
  );
}

/**
 * Pure: InstructionError [index, variant] | [index, { Custom: n }] only.
 * Non-instruction TransactionError → null (fail closed).
 */
export function parseSvmLandedInstructionError(
  err: unknown,
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
      const name = svmProgramErrorName(custom);
      if (name == null) return null;
      return { kind: "custom", name, ordinal: custom, index };
    }
  }
  return null;
}

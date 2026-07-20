/** Hardhat/etherscan verify errors where local compile ≠ on-chain bytecode (deploy still valid). */
const BYTECODE_MISMATCH_PATTERNS = [
  /HHE80009/i,
  /bytecode doesn'?t match/i,
  /does not match the contract/i,
  /compiled contract.*bytecode.*does not match/i,
  /unable to verify.*bytecode/i,
] as const;

export function isBytecodeMismatchVerifyError(output: string): boolean {
  // Hardhat may retry after a failed *minimal* solc input; that prose alone is
  // not a terminal mismatch (full input can still verify successfully).
  if (
    /failed using the minimal compiler input/i.test(output) &&
    !/HHE80009/i.test(output) &&
    !/bytecode doesn'?t match/i.test(output)
  ) {
    return false;
  }
  return BYTECODE_MISMATCH_PATTERNS.some((pattern) => pattern.test(output));
}

export function hardhatErrorCode(output: string): string | undefined {
  const match = output.match(/\bHHE\d{5}\b/i);
  return match?.[0]?.toUpperCase();
}

/** One-line summary for unexpected failures (full output stays in thrown Error). */
export function summarizeVerifyError(output: string): string {
  const code = hardhatErrorCode(output);
  const firstLine = output.split("\n").find((line) => line.trim())?.trim() ?? output;
  if (code && !firstLine.includes(code)) return `${code}: ${firstLine}`;
  return firstLine;
}

/**
 * Parse Solana meta.logMessages invoke stack → emitting program per program-data line.
 */

import { isLogTruncationSuspect, PROGRAM_DATA_PREFIX } from "./program-data-decode";

const PROGRAM_INVOKE_RE =
  /^Program ([1-9A-HJ-NP-Za-km-z]{32,44}) invoke \[(\d+)\]/;
const PROGRAM_SUCCESS_RE =
  /^Program ([1-9A-HJ-NP-Za-km-z]{32,44}) success/;
const PROGRAM_FAILED_RE =
  /^Program ([1-9A-HJ-NP-Za-km-z]{32,44}) failed:/;

export type ProgramDataLineRef = {
  logIndex: number;
  emittingProgram: string;
  sourceLine: string;
};

export type ParseProgramDataResult = {
  lines: ProgramDataLineRef[];
  logTruncationSuspect: boolean;
};

/**
 * Walk log lines with an invoke stack; attribute each `Program data:` line to the
 * innermost active program at that index.
 */
export function parseProgramDataFromLogMessages(
  logMessages: readonly string[] | null | undefined,
  followedPrograms: ReadonlySet<string>,
): ParseProgramDataResult {
  const logs = logMessages ?? [];
  const logTruncationSuspect = isLogTruncationSuspect(logs);
  const stack: string[] = [];
  const lines: ProgramDataLineRef[] = [];

  for (let logIndex = 0; logIndex < logs.length; logIndex++) {
    const line = logs[logIndex]!;
    const invoke = line.match(PROGRAM_INVOKE_RE);
    if (invoke) {
      stack.push(invoke[1]!);
      continue;
    }
    const success = line.match(PROGRAM_SUCCESS_RE);
    if (success) {
      popStack(stack, success[1]!);
      continue;
    }
    const failed = line.match(PROGRAM_FAILED_RE);
    if (failed) {
      popStack(stack, failed[1]!);
      continue;
    }
    if (!line.startsWith(PROGRAM_DATA_PREFIX)) continue;

    const emittingProgram = stack.at(-1);
    if (!emittingProgram) continue;
    if (!followedPrograms.has(emittingProgram)) continue;

    lines.push({ logIndex, emittingProgram, sourceLine: line });
  }

  return { lines, logTruncationSuspect };
}

function popStack(stack: string[], programId: string): void {
  if (stack.length === 0) return;
  const top = stack.at(-1);
  if (top === programId) {
    stack.pop();
    return;
  }
  const idx = stack.lastIndexOf(programId);
  if (idx >= 0) stack.splice(idx);
}

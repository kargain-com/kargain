/**
 * Parse validator transaction meta for structured log byte budget (S7a D-28 gate).
 *
 * Agave prints `sol_log_data` as `Program data: <base64>` in meta.logMessages.
 * Use `getTransaction` (json encoding), not `getParsedTransaction`.
 */

export {
  decodeProgramDataBase64,
  isLogTruncationSuspect,
  PROGRAM_DATA_PREFIX,
  SOLANA_LOG_LIMITS,
} from "../../lib/svm/program-data-decode.js";

import {
  decodeProgramDataBase64,
  PROGRAM_DATA_PREFIX,
  SOLANA_LOG_LIMITS,
} from "../../lib/svm/program-data-decode.js";

/** Transaction meta shape from `getTransaction(..., { encoding: "json" })`. */
export type JsonTransactionMeta = {
  logMessages?: string[] | null;
  computeUnitsConsumed?: number | null;
  err?: unknown;
};

export type TxLogBudget = {
  logMessageBytes: number;
  logLineCount: number;
  programDataBytes: number;
  programDataLineCount: number;
  computeUnits: number | null;
};

export function measureTxLogBudgetFromMeta(
  meta: JsonTransactionMeta | null | undefined,
): TxLogBudget | null {
  if (!meta) return null;
  const logs = meta.logMessages ?? [];
  let logMessageBytes = 0;
  let programDataBytes = 0;
  let programDataLineCount = 0;
  for (const line of logs) {
    logMessageBytes += Buffer.byteLength(line, "utf8");
    if (line.startsWith(PROGRAM_DATA_PREFIX)) {
      programDataLineCount += 1;
      const encoded = line.slice(PROGRAM_DATA_PREFIX.length).trim();
      programDataBytes += decodeProgramDataBase64(encoded, line).length;
    }
  }
  return {
    logMessageBytes,
    logLineCount: logs.length,
    programDataBytes,
    programDataLineCount,
    computeUnits:
      meta.computeUnitsConsumed != null ? Number(meta.computeUnitsConsumed) : null,
  };
}

export function assertWithinLogLimits(budget: TxLogBudget, label: string): void {
  if (budget.logLineCount > SOLANA_LOG_LIMITS.maxLogLines) {
    throw new Error(
      `${label}: log line count ${budget.logLineCount} > ${SOLANA_LOG_LIMITS.maxLogLines}`,
    );
  }
  if (budget.logMessageBytes > SOLANA_LOG_LIMITS.maxLogDataBytes) {
    throw new Error(
      `${label}: log message bytes ${budget.logMessageBytes} > ${SOLANA_LOG_LIMITS.maxLogDataBytes}`,
    );
  }
}

export function assertStructuredPayloadPresent(budget: TxLogBudget, label: string): void {
  if (budget.programDataLineCount === 0) {
    throw new Error(`${label}: no Program data: log lines — structured surface not measured`);
  }
  if (budget.programDataBytes === 0) {
    throw new Error(`${label}: programDataBytes=0 after decode — measurement instrument broken`);
  }
}

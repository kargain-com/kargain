/**
 * Parse validator transaction meta for structured log byte budget (S7a D-28 gate).
 *
 * Agave prints `sol_log_data` as `Program data: <base64>` in meta.logMessages.
 * Use `getTransaction` (json encoding), not `getParsedTransaction`.
 */

/** Transaction meta shape from `getTransaction(..., { encoding: "json" })`. */
export type JsonTransactionMeta = {
  logMessages?: string[] | null;
  computeUnitsConsumed?: number | null;
  err?: unknown;
};

export type TxLogBudget = {
  /** UTF-8 byte length of all logMessages strings combined. */
  logMessageBytes: number;
  /** Count of log lines (includes CPI / Token program noise). */
  logLineCount: number;
  /** Base64-decoded byte length of all `Program data:` lines (structured emit surface). */
  programDataBytes: number;
  /** Number of `Program data:` lines observed. */
  programDataLineCount: number;
  /** solana `computeUnitsConsumed` when present. */
  computeUnits: number | null;
};

const PROGRAM_DATA_PREFIX = "Program data: ";

/**
 * Sum log footprint from confirmed transaction meta (json encoding).
 */
export function measureTxLogBudgetFromMeta(meta: JsonTransactionMeta | null | undefined): TxLogBudget | null {
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
      programDataBytes += decodeProgramDataBase64(encoded, line);
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

/** Decode Agave base64 `Program data:` payload; fail closed on any line. */
export function decodeProgramDataBase64(payload: string, sourceLine?: string): number {
  const trimmed = payload.trim();
  if (trimmed.length === 0) {
    throw new Error(
      `empty Program data payload${sourceLine ? `: ${sourceLine.slice(0, 80)}` : ""}`,
    );
  }
  if (!/^[A-Za-z0-9+/]+=*$/.test(trimmed)) {
    throw new Error(
      `Program data base64 alphabet invalid${sourceLine ? `: ${sourceLine.slice(0, 80)}` : ""}`,
    );
  }
  const buf = Buffer.from(trimmed, "base64");
  if (buf.length === 0) {
    throw new Error(
      `Program data decoded to zero bytes${sourceLine ? `: ${sourceLine.slice(0, 80)}` : ""}`,
    );
  }
  return buf.length;
}

/** Solana soft limits — measurement gate, not runtime enforcement. */
export const SOLANA_LOG_LIMITS = {
  /** ~10 KB total log data per transaction (reference). */
  maxLogDataBytes: 10_000,
  /** 64 log lines per transaction (reference). */
  maxLogLines: 64,
} as const;

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

/** Measured paths must carry at least one structured payload byte. */
export function assertStructuredPayloadPresent(budget: TxLogBudget, label: string): void {
  if (budget.programDataLineCount === 0) {
    throw new Error(`${label}: no Program data: log lines — structured surface not measured`);
  }
  if (budget.programDataBytes === 0) {
    throw new Error(`${label}: programDataBytes=0 after decode — measurement instrument broken`);
  }
}

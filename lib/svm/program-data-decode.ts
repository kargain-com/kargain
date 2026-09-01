/**
 * Sole owner: decode Agave `Program data:` base64 payloads (S7a D-28 / S7c-1).
 */

export const PROGRAM_DATA_PREFIX = "Program data: ";

/** Reference caps — measurement gate, not runtime enforcement (D-28). */
export const SOLANA_LOG_LIMITS = {
  maxLogDataBytes: 10_000,
  maxLogLines: 64,
} as const;

/** Decode Agave base64 `Program data:` payload; fail closed on any line. */
export function decodeProgramDataBase64(payload: string, sourceLine?: string): Buffer {
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
  return buf;
}

/** Extract base64 payload from a single log line, or null if not program-data. */
export function programDataPayloadFromLogLine(line: string): string | null {
  if (!line.startsWith(PROGRAM_DATA_PREFIX)) return null;
  return line.slice(PROGRAM_DATA_PREFIX.length).trim();
}

export function isLogTruncationSuspect(logMessages: readonly string[]): boolean {
  if (logMessages.length >= SOLANA_LOG_LIMITS.maxLogLines) return true;
  let bytes = 0;
  for (const line of logMessages) {
    bytes += Buffer.byteLength(line, "utf8");
  }
  return bytes >= SOLANA_LOG_LIMITS.maxLogDataBytes;
}

/**
 * Pure helpers for upgrade-in-place planned-change reporting (Phase 1 dry-run).
 */

export function maskBase58Id(id: string): string {
  if (id.length <= 8) return id;
  return `${id.slice(0, 4)}…${id.slice(-4)}`;
}

export function sanitizeCliDetail(text: string): string {
  return text
    .replace(/https?:\/\/[^\s)"']+/gi, "<RPC>")
    .replace(/\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/g, (id) =>
      id.length <= 8 ? id : `${id.slice(0, 4)}…${id.slice(-4)}`,
    )
    .trim();
}

export function isTransportCliFailure(detail: string): boolean {
  return /error sending request|timed out|ECONNRESET|socket hang up|429|rate.?limit|502|503|504/i.test(
    detail,
  );
}

/** True absent — not a transport AccountNotFound wrapper. */
export function isAbsentProgramShowFailure(detail: string): boolean {
  if (isTransportCliFailure(detail)) return false;
  return /unable to find|could not find the account|Program account not found/i.test(
    detail,
  );
}

export type UpgradePlannedChangeRow = {
  evidenceKey: string;
  maskedProgramId: string;
  priorDigest: string;
  newDigest: string;
  priorDeploySlot: string;
  soBytes: number;
};

export function formatUpgradePlannedChangeTable(
  rows: readonly UpgradePlannedChangeRow[],
): string {
  const lines = [
    "program | registry id | prior digest | new digest | prior deploySlot | soBytes",
    "--------|-------------|--------------|------------|------------------|--------",
  ];
  for (const row of rows) {
    lines.push(
      [
        row.evidenceKey,
        row.maskedProgramId,
        row.priorDigest,
        row.newDigest,
        row.priorDeploySlot,
        String(row.soBytes),
      ].join(" | "),
    );
  }
  return lines.join("\n");
}

export function parseProgramShowAuthority(showText: string): {
  ownerLine: string | null;
  authority: string | null;
} {
  const ownerMatch = showText.match(/Owner:\s*(\S+)/i);
  const authMatch = showText.match(/Authority:\s*(\S+)/);
  return {
    ownerLine: ownerMatch?.[1] ?? null,
    authority: authMatch?.[1] ?? null,
  };
}
